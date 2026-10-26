import { expect, test, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { bootstrapUnlockedSession, openPatientSection, assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';

const PROSE = 'Racconto clinico sintetico W15a: il testo originale resta leggibile, con enfasi e riferimenti conservati.';
const ORIGINAL = 'Originale inventato W15a: fonte documentale del diario, senza dati reali.';

test('Diario paziente: prosa, provenienza e storico senza cambiare Scale o Timeline', async ({ baseURL }) => {
    test.setTimeout(180_000);
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname) || new URL(baseURL).port === '3000') throw new Error('Runtime e archivio sintetici isolati richiesti');
    const baseline = process.env.PATIENT_DIARY_BASELINE === '1';
    const zoom = await openBrowserZoomFixture(baseURL); const page = zoom.page;
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        const fixture = await page.evaluate(async ({ prose, original }) => {
            const post = async (path: string, body: unknown) => {
                const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
                if (!response.ok) throw new Error(`Synthetic ${path}: ${response.status}`); return response.json();
            };
            const patient = await post('patients', { firstName: 'Diario', lastName: 'Sintetico', taxCode: `D15${crypto.randomUUID().replaceAll('-', '').slice(0, 13).toUpperCase()}`, birthDate: '1980-01-01T00:00:00Z', diagnoses: [] });
            const attachment = await post('attachments', { id: crypto.randomUUID(), patientId: patient.id, name: 'fonte-diario-inventata.txt', type: 'text/plain', size: original.length, path: 'uploads/fonte-diario-inventata.txt', data: `data:text/plain;base64,${btoa(original)}` });
            const entry = await post('entries', { patientId: patient.id, type: 'visit', date: '2026-10-26T10:00:00Z', title: 'Controllo sintetico W15a', content: `<p>${prose}</p><p>Secondo paragrafo con <strong>enfasi originale</strong> e <a href="https://synthetic.invalid/fonte">riferimento inventato</a>.</p>`, setting: 'ambulatory', attachments: [attachment.id], metadata: { authorName: 'Ada Sintetica', sourceLabel: 'Fonte documentale inventata', workflowStatus: 'signed' } });
            await post('entries', { patientId: patient.id, type: 'phone', date: '2026-10-25T09:30:00Z', title: 'Bozza sintetica conservata', content: 'Bozza storica sintetica W15a senza autore dichiarato.', setting: 'home', metadata: { workflowStatus: 'draft' } });
            await post('entries', { patientId: patient.id, type: 'legacy-local-note', date: '2026-10-24T09:00:00Z', title: 'Voce storica non classificata', content: 'Voce storica sintetica W15a: tipo non conosciuto, contenuto conservato.' });
            const scale = await post('entries', { patientId: patient.id, type: 'scale', date: '2026-10-23T08:00:00Z', title: 'Scala inventata W15a', content: 'Valutazione storica sintetica W15a.', metadata: { title: 'Scala inventata W15a', score: 5, interpretation: 'Interpretazione registrata inventata' } });
            return { patientId: patient.id as string, entryId: entry.id as string, scaleId: scale.id as string };
        }, { prose: PROSE, original: ORIGINAL });
        await page.goto(`/patients/${fixture.patientId}/modules`); await openPatientSection(page, 'diario');
        const pane = page.locator('#diario'), feed = pane.getByRole('feed', { name: 'Diario clinico del paziente', exact: true });
        await expect(feed.locator(':scope > article')).toHaveCount(3);
        const row = feed.locator(':scope > article').filter({ hasText: PROSE });
        if (!baseline) { await expect(row).toContainText('Ada Sintetica'); await expect(row).toContainText('Firmata'); await expect(row).toContainText('Fonte documentale inventata'); }
        await expect(row.locator('strong').filter({ hasText: 'enfasi originale' })).toHaveCount(1);
        await expect(row).toContainText('riferimento inventato');
        const draft = feed.locator(':scope > article').filter({ hasText: 'Bozza storica sintetica W15a' });
        if (!baseline) await expect(draft).toContainText('Bozza'); await expect(draft).not.toContainText('Autore:');
        await expect(feed).toContainText('Voce storica sintetica W15a: tipo non conosciuto');
        if (!baseline) {
            const margin = row.locator(':scope > time'); await expect(margin).toHaveCount(1);
            await expect(row).toHaveCSS('grid-template-columns', /^84px /u);
            await expect(row.locator('[data-ink="dry"]')).toContainText('Firmata');
            await expect(row.locator('.prose')).toHaveCSS('font-size', '17px');
        }
        const directory = process.env.PATIENT_DIARY_SCREENSHOTS; if (directory) await mkdir(directory, { recursive: true });
        const surfaces: unknown[] = [];
        const capture = async (state: string, anchor: Locator) => {
            for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
                await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
                if (size.startsWith('zoom-')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4); else await page.setViewportSize({ width: Number(size), height: 1000 });
                await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.classList.toggle('light', theme === 'giorno'); }, theme);
                if (!baseline && ['conferma', 'ripristino'].includes(state)) {
                    const modal = page.getByRole('dialog');
                    const origin = state === 'conferma' ? modal.getByRole('textbox', { name: /^Motivazione eliminazione/u }) : modal.getByRole('button', { name: 'Chiudi', exact: true });
                    await expect.poll(() => modal.evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= -1 && box.bottom <= innerHeight + 1; }), { message: `${state} ${theme} ${size}: dialogo entro viewport` }).toBe(true);
                    await origin.focus(); await page.keyboard.press('Tab'); await expect(anchor).toBeFocused();
                    expect(await modal.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
                } else await anchor.evaluate(element => element.scrollIntoView({ block: 'center' }));
                if (!baseline) await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: 'Diario', selector: '#diario' }]);
                if (!baseline && ['azioni', 'conferma', 'ripristino'].includes(state)) await assertNotClippedInViewport(anchor, state);
                if (!baseline && ['conferma', 'ripristino'].includes(state)) {
                    await expect.poll(() => anchor.evaluate(element => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return element === hit || element.contains(hit); }), { message: `${state} ${theme} ${size}: comando raggiungibile` }).toBe(true);
                    if (state === 'conferma' && size === 'zoom-400') {
                        expect(await page.getByRole('dialog').evaluate(element => element.scrollHeight > element.clientHeight && element.scrollTop > 0)).toBe(true);
                    }
                }
                if (!baseline && state === 'azioni') {
                    for (const item of await anchor.getByRole('menuitem').all()) {
                        await assertNotClippedInViewport(item, 'Azione del diario');
                        expect(await item.evaluate(element => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return element === hit || element.contains(hit); })).toBe(true);
                    }
                }
                surfaces.push({ state, theme, size, cssWidth: await page.evaluate(() => innerWidth) });
                if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-${state}.png`, animations: 'disabled' });
            }
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
        };
        await expect(row.getByRole('button', { name: 'fonte-diario-inventata.txt', exact: false })).toBeVisible();
        await capture('registrata', row); await capture('bozza-storica', draft);
        await row.getByRole('button', { name: 'fonte-diario-inventata.txt', exact: false }).click();
        const viewer = page.getByRole('dialog'); await expect(viewer.getByTestId('document-preview-text')).toHaveText(ORIGINAL); await capture('fonte', viewer.getByRole('button', { name: 'Chiudi', exact: true }));
        await viewer.getByRole('button', { name: 'Chiudi', exact: true }).click();
        const openDelete = async () => {
            if (baseline) await row.getByRole('button', { name: 'Elimina voce clinica con motivazione', exact: true }).click();
            else {
                await row.getByRole('button', { name: 'Azioni voce Controllo sintetico W15a', exact: true }).click();
                await page.getByRole('menuitem', { name: 'Elimina voce clinica con motivazione', exact: true }).click();
            }
        };
        if (!baseline) {
            const trigger = row.getByRole('button', { name: 'Azioni voce Controllo sintetico W15a', exact: true }); await trigger.focus(); await page.keyboard.press('ArrowDown');
            const menu = page.getByRole('menu', { name: 'Azioni voce Controllo sintetico W15a', exact: true }); await expect(menu.getByRole('menuitem')).toHaveText(['Elimina voce clinica con motivazione']); await capture('azioni', menu);
            await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
        } else await capture('azioni', row.getByRole('button', { name: 'Elimina voce clinica con motivazione', exact: true }));
        await openDelete(); const confirm = page.getByRole('dialog');
        await expect(confirm.getByRole('button', { name: 'Elimina', exact: true })).toBeDisabled();
        await confirm.getByRole('textbox', { name: /^Motivazione eliminazione/u }).fill('Motivo sintetico di prova W15a'); await capture('conferma', confirm.getByRole('button', { name: 'Annulla', exact: true }));
        await confirm.getByRole('button', { name: 'Annulla', exact: true }).click(); await expect(row).toBeVisible();
        await openDelete(); await page.getByRole('dialog').getByRole('textbox', { name: /^Motivazione eliminazione/u }).fill('Motivo sintetico di prova W15a'); await page.getByRole('dialog').getByRole('button', { name: 'Elimina', exact: true }).click();
        await expect(row).toHaveCount(0);
        const deletionNotice = page.getByRole('status').filter({ hasText: 'Voce spostata nel cestino.' });
        await expect(deletionNotice).toBeVisible();
        await deletionNotice.getByRole('button', { name: 'Chiudi notifica', exact: true }).click();
        const showDeleted = pane.getByRole('button', { name: baseline ? 'Mostra cestino / audit' : 'Mostra voci eliminate', exact: true }); await showDeleted.click();
        await expect(row).toContainText('Motivo sintetico di prova W15a'); await expect(row).toContainText(PROSE); await capture('cestino', row);
        await row.getByRole('button', { name: 'Ripristina voce clinica', exact: true }).click(); const restore = page.getByRole('dialog'); await capture('ripristino', restore.getByRole('button', { name: 'Annulla', exact: true })); await restore.getByRole('button', { name: 'Ripristina', exact: true }).click();
        await expect(row).not.toContainText('Motivo sintetico di prova W15a'); if (!baseline) await expect(row).toContainText('Ada Sintetica'); await expect(row.getByRole('button', { name: 'fonte-diario-inventata.txt', exact: false })).toBeVisible();
        await openPatientSection(page, 'scale'); await expect(page.getByRole('feed', { name: 'Storico delle scale del paziente', exact: true })).toContainText('Valutazione storica sintetica W15a.');
        await expect(page.locator('#scale article > time')).toHaveCount(0);
        await openPatientSection(page, 'timeline');
        if (baseline) await expect(page.locator('#timeline')).toContainText('Racconto clinico sintetico W15a');
        else {
            await expect(page.locator('#timeline')).not.toContainText(PROSE);
            await page.locator('#timeline').getByRole('link', { name: 'Apri Controllo sintetico W15a · Diario', exact: true }).click();
            await expect(pane).toBeVisible(); await expect(row).toContainText(PROSE);
        }
        await openPatientSection(page, 'diario'); await expect(feed.locator(':scope > article')).toHaveCount(3);
        const readback = await page.evaluate(async patientId => (await fetch(`/api/entries?patientId=${patientId}&includeDeleted=true`)).json(), fixture.patientId);
        expect(readback).toHaveLength(4); expect(readback.find((item: { id: string }) => item.id === fixture.entryId)).toMatchObject({ version: 3, deletedAt: null });
        const emptyPatientId = await page.evaluate(async () => { const response = await fetch('/api/patients', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName: 'Diario vuoto', lastName: 'Sintetico', taxCode: `E15${crypto.randomUUID().replaceAll('-', '').slice(0,13)}`, birthDate: '1980-01-01', diagnoses: [] }) }); if (!response.ok) throw new Error(String(response.status)); return (await response.json()).id; });
        await page.goto(`/patients/${emptyPatientId}/modules`); await openPatientSection(page, 'diario');
        const empty = page.locator('#diario').getByText('Nessuna voce visibile nel diario clinico.', { exact: true }); await expect(empty).toBeVisible(); await capture('vuoto', empty);
        expect(errors).toEqual([]);
        await test.info().attach('diary-surface-and-readback.json', { contentType: 'application/json', body: JSON.stringify({ baseline, zoomMechanism: 'chrome.tabs.setZoom/getZoom', surfaces, fixture, readback }) });
    } finally { await zoom.close(); }
});

test('Diario paziente distingue metadata object/JSON, assenti, illeggibili e stato sconosciuto per la stessa voce', async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname) || new URL(baseURL).port === '3000') throw new Error('Runtime e archivio sintetici isolati richiesti');
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const fixture = await page.evaluate(async () => {
        const post = async (path: string, body: unknown) => { const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(String(response.status)); return response.json(); };
        const metadata = { authorName: 'Ada Sintetica', sourceLabel: 'Fonte inventata coerente', workflowStatus: 'signed' };
        const patient = await post('patients', { firstName: 'Metadati', lastName: 'Sintetici', taxCode: crypto.randomUUID(), birthDate: '1980-01-01', diagnoses: [] });
        const entry = await post('entries', { patientId: patient.id, type: 'visit', date: '2026-10-26T10:00:00Z', title: 'Voce singola sintetica', content: 'Testo originale della stessa voce W15a.', setting: 'ambulatory', metadata });
        return { patientId: patient.id, entryId: entry.id, metadata };
    });
    let metadata: unknown = fixture.metadata;
    await page.route('**/api/entries?*', async route => {
        if (new URL(route.request().url()).searchParams.get('patientId') !== fixture.patientId) return route.continue();
        const response = await route.fetch(); const rows = await response.json();
        await route.fulfill({ response, json: rows.map((row: { id: string }) => row.id === fixture.entryId ? { ...row, metadata } : row) });
    });
    const row = page.locator('#diario article').filter({ hasText: 'Testo originale della stessa voce W15a.' });
    const read = async () => { await page.goto(`/patients/${fixture.patientId}/modules`); await openPatientSection(page, 'diario'); await expect(row).toBeVisible(); };
    await read(); await expect(row).toContainText('Ada Sintetica'); await expect(row).toContainText('Fonte inventata coerente'); await expect(row).toContainText('Firmata');
    const objectPresentation = await row.innerText();
    metadata = JSON.stringify(fixture.metadata); await read(); expect(await row.innerText()).toBe(objectPresentation);
    for (const value of ['{"authorName":', 'ENC:synthetic-unreadable', { authorName: 'ENC:synthetic-unreadable', workflowStatus: 'signed' }]) {
        metadata = value; await read(); await expect(row).toContainText('Metadati della voce non leggibili.');
        await expect(row).toContainText('Stato non leggibile'); await expect(row).toContainText('Fonte: Non leggibile');
        await expect(row).not.toContainText('Ada Sintetica'); await expect(row).not.toContainText('Firmata'); await expect(row).not.toContainText('Registrata'); await expect(row.locator('[data-ink]')).toHaveCount(0);
    }
    metadata = { ...fixture.metadata, workflowStatus: 'future-unrecognized-state' }; await read(); await expect(row).toContainText('Stato non riconosciuto'); await expect(row).toContainText('Ada Sintetica'); await expect(row.locator('[data-ink]')).toHaveCount(0);
    metadata = null; await read(); await expect(row).toContainText('Registrata'); await expect(row).not.toContainText('Metadati della voce non leggibili.'); await expect(row).not.toContainText('Autore:');
    const response = await page.request.get(`/api/entries?patientId=${fixture.patientId}`); const stored = await response.json();
    expect(stored[0]).toMatchObject({ id: fixture.entryId, version: 1, metadata: JSON.stringify(fixture.metadata) });
});
