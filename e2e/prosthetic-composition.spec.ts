import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { bootstrapUnlockedSession, openPatientSection, assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';

const NAME = 'Ausilio sintetico W14b di verifica';

async function createPatient(page: Page) {
    return page.evaluate(async () => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ firstName: 'Protesica', lastName: 'Sintetica', taxCode: `B14${crypto.randomUUID().replaceAll('-', '').slice(0, 13).toUpperCase()}`,
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

test('Protesica: bozza, provenienza e azioni nei due temi e allo zoom reale', async ({ baseURL }) => {
    test.setTimeout(180_000);
    const baseline = process.env.PROSTHETICS_BASELINE === '1';
    const zoom = await openBrowserZoomFixture(baseURL!);
    const page = zoom.page;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        const patientId = await createPatient(page);
        const original = 'Originale repertorio inventato W14b. Nessun dato reale.';
        const source = await page.evaluate(async ({ name, original }) => {
            const sourceName = `Fonte W14b sintetica ${crypto.randomUUID().slice(0, 8)}`;
            const csv = `codice_sistema,codice,descrizione,versione,fonte,ambito,data_inizio,data_fine\nSistema inventato,W14B-SYNTH,${name},v1,${sourceName},Dimostrazione,,\n`;
            const body = { sourceName: 'w14b-repertorio-sintetico.csv', base64: btoa(csv) };
            const post = async (path: string, body: unknown) => {
                const response = await fetch(`/api/prosthetics/catalog/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
                const value = await response.json(); if (!response.ok) throw new Error(`Synthetic catalog ${path}: ${response.status} ${JSON.stringify(value)}`); return value;
            };
            const preview = await post('preview', body);
            await post('commit', { ...body, proof: preview.proof, acceptSubset: true });
            const sources = await (await fetch('/api/prosthetics/catalog/sources')).json();
            const source = sources.sources.find((row: { name: string }) => row.name === sourceName);
            const status = await (await fetch('/api/prosthetics/catalog/status')).json();
            const document = await post('documents', { sourceId: source.id, revision: status.revision, name: 'originale-w14b-sintetico.txt', base64: btoa(original), page: '1' });
            return { id: source.id as string, name: sourceName, sha256: source.sha256 as string, document: { id: document.id as string, name: document.name as string, sha256: document.sha256 as string } };
        }, { name: NAME, original });
        await page.goto(`/patients/${patientId}/modules`); await openPatientSection(page, 'protesica');
        const pane = page.locator('#protesica');
        const create = pane.getByRole('button', { name: /^Nuova voce(?: protesica)?$/u });
        const headerCreate = page.getByRole('link', { name: 'Nuova voce', exact: true });
        await expect(pane.getByText('Nessuna prescrizione protesica registrata per questo paziente.', { exact: true })).toBeVisible();
        await expect(pane.getByRole('heading', { name: /^Diario ausili e prescrizioni/u })).toHaveCount(1);
        if (!baseline) {
            await expect(create).toHaveClass(/mf-button-text/u);
            await expect(pane.locator('[data-section-header]').getByRole('button', { name: 'Nuova voce protesica', exact: true })).toHaveCount(1);
            await expect(pane).toContainText('0 voci');
        }
        const directory = process.env.PROSTHETICS_CAPTURES;
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
                if (!baseline) await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: 'Protesica', selector: '#protesica' }]);
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
        await pane.getByRole('button', { name: 'Cerca un ausilio nel repertorio', exact: true }).click();
        await pane.getByRole('combobox', { name: 'Fonte', exact: true }).selectOption(source.id);
        await pane.getByLabel('Codice, descrizione o codifica', { exact: true }).fill('W14B-SYNTH');
        await pane.getByRole('button', { name: 'Cerca nel repertorio', exact: true }).click();
        await pane.getByRole('button', { name: 'Usa voce nella bozza', exact: true }).click();
        const description = pane.getByLabel('Descrizione ausilio');
        await expect(description).toHaveValue(NAME);
        await expect(pane.getByLabel('Codice ISO', { exact: true })).toHaveValue('');
        await pane.getByRole('button', { name: 'Cerca un ausilio nel repertorio', exact: true }).click();
        await pane.getByLabel('Data prescrizione', { exact: true }).fill('2026-10-25');
        await pane.getByLabel('Misure / configurazione', { exact: true }).fill('Configurazione sintetica W14b');
        await pane.getByLabel('Motivazione clinico-funzionale', { exact: true }).fill('Motivazione sintetica da conservare');
        await pane.getByLabel('Allegati / riferimenti', { exact: true }).fill('Riferimento sintetico W14b');
        await pane.getByLabel('Numero pratica / prescrizione', { exact: true }).fill('W14B-SYNTHETIC');
        await expect(headerCreate).not.toHaveClass(/mf-button-primary/u);
        await captures('form', description);
        const save = pane.getByRole('button', { name: 'Salva voce', exact: true });
        await captures('invio', save, true);
        await pane.getByRole('button', { name: 'Annulla', exact: true }).click();
        if (!baseline) await expect(create).toBeFocused();
        await create.click(); await expect(description).toHaveValue(NAME);
        await openPatientSection(page, 'quadro'); await openPatientSection(page, 'protesica');
        await expect(description).toHaveValue(NAME); await save.click();
        const row = pane.getByRole('row').filter({ has: page.locator('td > strong').filter({ hasText: NAME }) });
        await expect(row).toBeVisible(); await expect(headerCreate).toHaveClass(/mf-button-primary/u);
        if (!baseline) await expect(pane).toContainText('1 voce');
        await expect(row).toContainText(`Fonte: ${source.name} · v1`);
        await captures('riga', row);
        await row.getByRole('button', { name: 'Misure, collaudo e documenti', exact: true }).click();
        await expect(row).toContainText('Configurazione sintetica W14b');
        await expect(row).toContainText('Riferimento sintetico W14b');
        await captures('dettagli', row);
        await row.getByRole('button', { name: 'Provenienza registrata', exact: true }).click();
        await expect(row).toContainText(source.sha256);
        const link = row.getByRole('link', { name: `${source.document.name} · pagina 1`, exact: true });
        await expect(link).toHaveAttribute('href', `/api/prosthetics/catalog/documents?id=${source.document.id}&sha256=${source.document.sha256}`);
        const downloaded = await page.request.get((await link.getAttribute('href'))!);
        expect(downloaded.status()).toBe(200); expect(await downloaded.body()).toEqual(Buffer.from(original));
        await captures('fonte', link, true);
        const menuTrigger = row.getByRole('button', { name: `Azioni voce protesica ${NAME}`, exact: true });
        if (!baseline) {
            await menuTrigger.focus(); await page.keyboard.press('ArrowDown');
            const menu = page.getByRole('menu', { name: `Azioni voce protesica ${NAME}`, exact: true });
            await expect(menu.getByRole('menuitem')).toHaveText(['Elimina voce protesica']);
            await captures('azioni', menu);
            await page.keyboard.press('Escape'); await expect(menuTrigger).toBeFocused();
        } else await captures('azioni', row);
        await row.getByRole('button', { name: 'Collaudo', exact: true }).click();
        await expect(row).toContainText('Collaudata');
        await expect(row.getByRole('button', { name: 'Collaudo', exact: true })).toHaveCount(0);
        await expect(row).toContainText(source.sha256);
        if (!baseline) {
            await menuTrigger.click();
            await page.getByRole('menuitem', { name: 'Elimina voce protesica', exact: true }).click();
        } else await row.getByRole('button', { name: `Elimina ${NAME}`, exact: true }).click();
        const dialog = page.getByRole('dialog'); await expect(dialog).toContainText(NAME);
        await captures('conferma-eliminazione', dialog.getByRole('button', { name: 'Annulla', exact: true }), true);
        await dialog.getByRole('button', { name: 'Annulla', exact: true }).click(); await expect(row).toBeVisible();
        expect(errors).toEqual([]);
        await test.info().attach('surface-matrix.json', { contentType: 'application/json', body: JSON.stringify({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), baseline, zoomMechanism: 'chrome.tabs.setZoom/getZoom', surfaces }) });
    } finally { await zoom.close(); }
});
