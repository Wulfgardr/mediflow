import { expect, test, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { bootstrapUnlockedSession, openPatientSection, assertNoHorizontalOverflow, assertNotClippedInViewport } from './utils';

test('SISS: diario locale, pre-controllo ed esportazione senza servizi regionali', async ({ baseURL }) => {
    test.setTimeout(180_000);
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname) || new URL(baseURL).port === '3000') throw new Error('Archivio e runtime sintetici isolati richiesti');
    const baseline = process.env.SISS_BASELINE === '1';
    const zoom = await openBrowserZoomFixture(baseURL);
    const page = zoom.page;
    const errors: string[] = [], external: string[] = [];
    let validationMode = 'clean';
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
        if (new URL(route.request().url()).origin !== new URL(baseURL).origin) { external.push(route.request().url()); return route.abort(); }
        return route.continue();
    });
    // Install before mounting SISS: the real observer must never read browser history.
    await page.route('**/api/siss/session-status', route => route.fulfill({ json: { status: 'unavailable', source: 'atlas-history', checkedAt: '2026-10-26T10:00:00Z', browserProfile: null, warning: 'Stato sintetico: nessuna osservazione reale.', sessionHealth: 'none', lastModule: null, lastModuleLabel: null, lastModuleAt: null, checkpoints: [] } }));
    await page.route('**/api/fse/validate-patient?*', route => {
        if (validationMode === 'error') return route.fulfill({ status: 503, json: { error: 'Controllo sintetico indisponibile' } });
        const summary = { total: 0, ok: 0, withErrors: 0, withWarnings: 0, errorCount: 0, warningCount: 0, items: [] };
        return route.fulfill({ json: { patientId: new URL(route.request().url()).searchParams.get('patientId'), hasErrors: validationMode === 'blocked', hasWarnings: validationMode === 'warning', therapyMedication: summary, observationVitals: summary } });
    });
    await page.route('**/api/siss/context', route => route.fulfill({ json: { status: 'handoff', handoffUrl: 'https://synthetic.invalid/siss-ui', clipboardText: null, correlationId: 'w14c-synthetic', message: 'Passaggio sintetico', action: 'menu.open', title: 'Menu SISS', mode: 'portal-handoff' } }));
    await page.addInitScript(() => {
        const opened: string[] = [];
        Object.assign(window, { __sissSyntheticOpened: opened });
        window.open = () => ({ opener: null, blur() {}, focus() {}, close() {}, location: { set href(value: string) { opened.push(value); } } }) as unknown as Window;
    });
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        const patientId = await page.evaluate(async () => {
            const response = await fetch('/api/patients', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName: 'Siss', lastName: 'Sintetico', taxCode: `C14${crypto.randomUUID().replaceAll('-', '').slice(0, 13).toUpperCase()}`, birthDate: '1980-01-01T00:00:00Z', diagnoses: [] }) });
            if (!response.ok) throw new Error(`Synthetic patient ${response.status}`); return (await response.json()).id as string;
        });
        await page.goto(`/patients/${patientId}/modules`); await openPatientSection(page, 'siss');
        const pane = page.locator('#siss');
        const directory = process.env.SISS_SCREENSHOTS; if (directory) await mkdir(directory, { recursive: true });
        const surfaces: unknown[] = [];
        const capture = async (state: string, anchor: Locator) => {
            for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
                await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
                if (size.startsWith('zoom-')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4); else await page.setViewportSize({ width: Number(size), height: 1000 });
                await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.classList.toggle('light', theme === 'giorno'); }, theme);
                await anchor.evaluate(element => element.scrollIntoView({ block: 'center' }));
                if (!baseline) await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: 'SISS', selector: '#siss' }]);
                if (!baseline && ['invio', 'azioni', 'conferma'].includes(state)) await assertNotClippedInViewport(anchor, state);
                surfaces.push({ state, theme, size, cssWidth: await page.evaluate(() => innerWidth) });
                if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-${state}.png`, animations: 'disabled' });
            }
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
        };
        const exportButton = pane.getByRole('button', { name: baseline ? 'Esporta' : 'Esporta FHIR', exact: true });
        await expect(exportButton).toBeVisible(); await capture('esportazione', exportButton);
        await exportButton.click(); const exportDialog = page.getByRole('dialog'); await expect(exportDialog).toContainText('Esporta FHIR con controllo FSE');
        if (!baseline) await expect(exportDialog).toContainText('locale');
        await capture('export-modal', exportDialog.getByRole('button', { name: 'Annulla', exact: true }));
        await exportDialog.getByRole('button', { name: 'Annulla', exact: true }).click();
        const requirements = pane.getByRole('button', { name: 'Requisiti e controllo locale dei dati', exact: true });
        if (await requirements.getAttribute('aria-expanded') !== 'true') await requirements.click();
        for (const mode of ['warning', 'blocked', 'error']) {
            validationMode = mode;
            await pane.getByRole('button', { name: 'Aggiorna controllo FSE locale', exact: true }).click();
            await expect(pane).toContainText(mode === 'error' ? 'Controllo FSE non disponibile al momento.' : mode === 'blocked' ? (baseline ? 'FSE: blocchi' : 'Dati da correggere per l’esportazione FSE. Puoi aprire i portali.') : (baseline ? 'FSE: attenzioni' : 'Dati da verificare per l’esportazione FSE.'));
            await capture(`precheck-${mode}`, requirements);
        }
        validationMode = 'clean'; await pane.getByRole('button', { name: 'Aggiorna controllo FSE locale', exact: true }).click();
        const diaryToggle = pane.getByRole('button', { name: baseline ? 'Diario dei passaggi' : /^Diario locale dei passaggi/u });
        if (await diaryToggle.getAttribute('aria-expanded') !== 'true') await diaryToggle.click();
        const create = pane.getByRole('button', { name: baseline ? 'Registra' : 'Registra passaggio', exact: true });
        await capture('vuoto', create);
        if (!baseline) {
            await expect(create).toHaveClass(/mf-button-text/u);
            const title = diaryToggle;
            await expect(title).toHaveCSS('font-size', '12px');
            await expect(title).toHaveCSS('text-transform', 'uppercase');
            await expect(pane.locator('[data-section-header]').getByRole('button', { name: 'Registra passaggio', exact: true })).toHaveCount(1);
        }
        await create.focus(); await page.keyboard.press('Enter');
        const form = pane.locator('form').filter({ has: page.getByLabel('Perché ho aperto il portale', { exact: true }) });
        await form.getByLabel('Perché ho aperto il portale', { exact: true }).fill('Verifica sintetica W14c');
        await form.getByRole('textbox', { name: 'Cosa va ricordato', exact: true }).fill('Nota locale da conservare');
        await form.getByRole('textbox', { name: 'Prossima azione', exact: true }).fill('Prossimo passo sintetico');
        if (!baseline) {
            await expect(create).not.toHaveClass(/mf-button-primary/u);
            await form.getByRole('button', { name: 'Annulla', exact: true }).click(); await expect(create).toBeFocused(); await create.click();
            await expect(form.getByLabel('Perché ho aperto il portale', { exact: true })).toHaveValue('Verifica sintetica W14c');
            await openPatientSection(page, 'quadro'); await openPatientSection(page, 'siss');
            await expect(form.getByRole('textbox', { name: 'Cosa va ricordato', exact: true })).toHaveValue('Nota locale da conservare');
        }
        if (!baseline) await expect(page.getByRole('link', { name: 'Nuova voce', exact: true })).not.toHaveClass(/mf-button-primary/u);
        await capture('form', form.getByLabel('Perché ho aperto il portale', { exact: true }));
        const save = form.getByRole('button', { name: 'Salva voce', exact: true }); await capture('invio', save); await save.click();
        const row = baseline ? pane.locator('div.rounded-\\[18px\\]').filter({ has: page.getByText('Verifica sintetica W14c', { exact: true }) }) : pane.locator('[data-siss-handoff-id]').filter({ hasText: 'Anagrafe' });
        await expect(row).toBeVisible();
        if (!baseline) await row.getByRole('button', { name: 'Dettagli del passaggio', exact: true }).click();
        await expect(row).toContainText('Nota locale da conservare'); await expect(row).toContainText('Prossimo passo sintetico'); await capture('dettagli', row);
        if (!baseline) {
            const trigger = row.getByRole('button', { name: 'Azioni passaggio Anagrafe', exact: true }); await trigger.focus(); await page.keyboard.press('ArrowDown');
            const menu = page.getByRole('menu', { name: 'Azioni passaggio Anagrafe', exact: true }); await expect(menu.getByRole('menuitem')).toHaveText(['Elimina passaggio SISS']); await capture('azioni', menu);
            await page.keyboard.press('Escape'); await expect(trigger).toBeFocused(); await trigger.click(); await page.getByRole('menuitem', { name: 'Elimina passaggio SISS', exact: true }).click();
        } else await row.getByRole('button', { name: 'Elimina passaggio SISS', exact: true }).click();
        const confirm = page.getByRole('dialog'); await capture('conferma', confirm.getByRole('button', { name: 'Annulla', exact: true })); await confirm.getByRole('button', { name: 'Annulla', exact: true }).click(); await expect(row).toBeVisible();
        await pane.getByRole('button', { name: baseline ? 'Apri Menu SISS' : 'Apri Menu SISS, fuori da MediFlow', exact: true }).click();
        await expect(pane.getByRole('button', { name: 'Chiudi passaggio', exact: true })).toBeVisible();
        const closure = pane.getByRole('button', { name: 'Chiudi passaggio', exact: true }).locator('..');
        await closure.getByRole('textbox', { name: 'Cosa va ricordato', exact: true }).fill('Esito dichiarato soltanto locale');
        if (!baseline) {
            await expect(closure.getByRole('combobox', { name: 'Esito del passaggio aperto', exact: true })).toBeVisible();
            await expect(page.getByRole('link', { name: 'Nuova voce', exact: true })).not.toHaveClass(/mf-button-primary/u);
        }
        await capture('chiusura', closure.getByRole('button', { name: 'Chiudi passaggio', exact: true }));
        await closure.getByRole('button', { name: 'Chiudi passaggio', exact: true }).click();
        await expect(pane.getByRole('button', { name: 'Chiudi passaggio', exact: true })).toHaveCount(0);
        const readback = await page.evaluate(async patientId => (await fetch(`/api/siss-handoffs?patientId=${patientId}`)).json(), patientId);
        if (!baseline) {
            const completed = pane.locator('[data-siss-handoff-id]').filter({ hasText: 'Menu SISS' });
            await completed.getByRole('button', { name: 'Dettagli del passaggio', exact: true }).click();
            await expect(completed).toContainText('Esito dichiarato soltanto locale');
        }
        expect(readback).toHaveLength(2); expect(readback.some((item: { notes: string; outcome: string; version: number }) => item.notes.startsWith('ENC:') && item.outcome === 'completed' && item.version === 2)).toBe(true);
        expect(await page.evaluate(() => (window as Window & { __sissSyntheticOpened?: string[] }).__sissSyntheticOpened)).toEqual(['https://synthetic.invalid/siss-ui']);
        if (!baseline) {
            await expect(page.getByRole('link', { name: 'Nuova voce', exact: true })).toHaveClass(/mf-button-primary/u);
            await row.getByRole('button', { name: 'Azioni passaggio Anagrafe', exact: true }).click();
            await page.getByRole('menuitem', { name: 'Elimina passaggio SISS', exact: true }).click();
            await page.getByRole('dialog').getByRole('button', { name: 'Elimina', exact: true }).click();
            await expect(row).toHaveCount(0);
            const remaining = await page.evaluate(async patientId => (await fetch(`/api/siss-handoffs?patientId=${patientId}`)).json(), patientId);
            expect(remaining).toHaveLength(1); expect(remaining[0].action).toBe('menu.open');
        }
        expect(external).toEqual([]); expect(errors).toEqual([]);
        await test.info().attach('surface-and-readback.json', { contentType: 'application/json', body: JSON.stringify({ baseline, zoomMechanism: 'chrome.tabs.setZoom/getZoom', surfaces, readback, external }) });
    } finally { await zoom.close(); }
});
