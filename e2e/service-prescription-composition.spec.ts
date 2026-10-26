import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { bootstrapUnlockedSession, openPatientSection, assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';

const NAME = 'Prestazione sintetica di verifica con due voci richieste';

async function createPatient(page: Page) {
    return page.evaluate(async () => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ firstName: 'Prestazioni', lastName: 'Sintetiche', taxCode: `W14${crypto.randomUUID().replaceAll('-', '').slice(0, 13).toUpperCase()}`,
                birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }) });
        if (!response.ok) throw new Error(`Synthetic patient: ${response.status}`);
        return (await response.json() as { id: string }).id;
    });
}

async function centered(control: Locator) {
    await control.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await control.focus();
    await assertNotClippedInViewport(control, 'Comando prestazione');
    expect(await control.evaluate(element => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return element === hit || element.contains(hit);
    }), 'Il comando deve essere raggiungibile senza sovrapposizioni').toBe(true);
}

test('Prestazioni: composizione, bozza, dettagli e conferma nei due temi e allo zoom reale', async ({ baseURL }) => {
    test.setTimeout(180_000);
    const baseline = process.env.SERVICES_BASELINE === '1';
    const zoom = await openBrowserZoomFixture(baseURL!);
    const page = zoom.page;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        const patientId = await createPatient(page);
        await page.goto(`/patients/${patientId}/modules`); await openPatientSection(page, 'prestazioni');
        const pane = page.locator('#prestazioni');
        const create = pane.getByRole('button', { name: 'Nuova prestazione', exact: true });
        const headerCreate = page.getByRole('link', { name: 'Nuova voce', exact: true });
        await expect(pane.getByText(/^Nessuna prestazione prescritta registrata\./u)).toBeVisible();
        await expect(pane.getByRole('heading', { name: /^Prestazioni prescritte/u })).toHaveCount(1);
        if (!baseline) {
            await expect(create).toHaveClass(/mf-button-text/u);
            await expect(pane.locator('[data-section-header]').getByRole('button', { name: 'Nuova prestazione' })).toHaveCount(1);
            await expect(pane).toContainText('0 prestazioni');
        }
        const directory = process.env.SERVICES_CAPTURES;
        if (directory) await mkdir(directory, { recursive: true });
        const surfaces: Array<Record<string, unknown>> = [];
        const captures = async (state: string, anchor: Locator, control = false) => {
            for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
                await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
                if (size.startsWith('zoom-')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4);
                else await page.setViewportSize({ width: Number(size), height: 1000 });
                await page.evaluate(theme => {
                    document.documentElement.classList.toggle('dark', theme === 'grafite');
                    document.documentElement.classList.toggle('light', theme === 'giorno');
                }, theme);
                if (control) await centered(anchor); else await anchor.scrollIntoViewIfNeeded();
                if (!baseline) await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: 'Prestazioni', selector: '#prestazioni' }]);
                if (!baseline && state === 'azioni') {
                    for (const item of await anchor.getByRole('menuitem').all()) {
                        await assertNotClippedInViewport(item, 'Azione nel menu');
                        expect(await item.evaluate(element => {
                            const box = element.getBoundingClientRect();
                            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
                            return box.top >= 0 && box.bottom <= innerHeight && (element === hit || element.contains(hit));
                        }), 'Le azioni devono restare visibili e raggiungibili').toBe(true);
                    }
                }
                surfaces.push({ state, theme, size, physicalWidth: page.viewportSize()?.width, cssWidth: await page.evaluate(() => innerWidth), zoom: size === 'zoom-200' ? 2 : size === 'zoom-400' ? 4 : 1 });
                if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-${state}.png`, animations: 'disabled' });
            }
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
        };
        await captures('vuoto', create);
        await create.focus(); await page.keyboard.press('Enter');
        const name = pane.getByLabel('Nome prestazione (raggruppa le voci)');
        await name.fill(NAME);
        await pane.getByLabel('Voci richieste - una per riga, opzionale CODICE NOME').fill('Voce sintetica uno\nVoce sintetica due');
        await pane.getByLabel('Data prescrizione', { exact: true }).fill('2026-10-25');
        await pane.getByPlaceholder('Motivazione e quesito alla base della richiesta').fill('Quesito sintetico da conservare. Nessun dato reale.');
        await pane.getByLabel('Struttura / erogatore', { exact: true }).fill('Struttura sintetica');
        await pane.getByLabel('Riferimento ricetta / impegnativa').fill('W14A-SYNTHETIC');
        await expect(headerCreate).not.toHaveClass(/mf-button-primary/u);
        await captures('form', name);
        const save = pane.getByRole('button', { name: 'Salva prestazione', exact: true });
        await captures('invio', save, true);
        await pane.getByRole('button', { name: 'Annulla', exact: true }).click();
        if (!baseline) await expect(create).toBeFocused();
        await create.click(); await expect(name).toHaveValue(NAME);
        await openPatientSection(page, 'quadro'); await openPatientSection(page, 'prestazioni');
        await expect(name).toHaveValue(NAME);
        await save.click();
        const row = pane.getByRole('row').filter({ has: page.getByText(NAME, { exact: true }) });
        await expect(row).toBeVisible(); await expect(headerCreate).toHaveClass(/mf-button-primary/u);
        if (!baseline) await expect(pane).toContainText('1 prestazione');
        await captures('riga', row);
        const details = row.getByRole('button', { name: 'Dettagli, referti e documenti', exact: true });
        await details.focus(); await page.keyboard.press('Enter');
        await expect(row).toContainText('Quesito sintetico da conservare.');
        await expect(row).toContainText('Voce sintetica uno'); await expect(row).toContainText('Voce sintetica due');
        await captures('dettagli', row);
        const menuTrigger = row.getByRole('button', { name: `Azioni prestazione ${NAME}`, exact: true });
        if (!baseline) {
            await menuTrigger.focus(); await page.keyboard.press('ArrowDown');
            const menu = page.getByRole('menu', { name: `Azioni prestazione ${NAME}`, exact: true });
            await expect(menu.getByRole('menuitem')).toHaveText(['Segna eseguita', 'Referto ricevuto', 'Annulla prestazione']);
            await captures('azioni', menu);
            await page.keyboard.press('Escape'); await expect(menuTrigger).toBeFocused();
            await menuTrigger.click(); await menu.getByRole('menuitem', { name: 'Segna eseguita', exact: true }).click();
        } else {
            await captures('azioni', row);
            await row.getByRole('button', { name: 'Segna eseguita', exact: true }).click();
        }
        await expect(row).toContainText('Eseguita');
        if (!baseline) {
            await menuTrigger.click();
            const menu = page.getByRole('menu', { name: `Azioni prestazione ${NAME}`, exact: true });
            await expect(menu.getByRole('menuitem')).toHaveText(['Elimina prestazione']);
            await menu.getByRole('menuitem', { name: 'Elimina prestazione', exact: true }).click();
        } else await row.getByRole('button', { name: 'Elimina voce', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText(NAME);
        await captures('conferma-eliminazione', dialog.getByRole('button', { name: 'Annulla', exact: true }), true);
        await dialog.getByRole('button', { name: 'Annulla', exact: true }).click();
        await expect(row).toBeVisible();
        expect(errors).toEqual([]);
        await test.info().attach('surface-matrix.json', { contentType: 'application/json', body: JSON.stringify({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), baseline, zoomMechanism: 'chrome.tabs.setZoom/getZoom', surfaces }) });
    } finally { await zoom.close(); }
});
