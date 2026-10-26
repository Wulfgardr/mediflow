import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow } from './utils';

function requireSynthetic(baseURL?: string) {
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000') throw new Error('Runtime e archivio sintetici isolati richiesti');
}
async function protect(page: Page, baseURL: string) {
    await page.route('**/api/siss/session-status', route => route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } }));
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
}
function deferred() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
}

test('Indice Impostazioni: gerarchia, stati e risposta persa dopo PUT reale', async ({ baseURL }) => {
    test.setTimeout(180_000); requireSynthetic(baseURL);
    const baseline = process.env.SETTINGS_INDEX_BASELINE === '1', causal = process.env.SETTINGS_INDEX_CAUSAL === '1';
    const directory = process.env.SETTINGS_INDEX_SCREENSHOTS;
    const zoom = await openBrowserZoomFixture(baseURL!), page = zoom.page;
    await protect(page, baseURL!);
    const errors: string[] = [], writes: string[] = [], surfaces: unknown[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/settings/network.mode') writes.push(request.postData() ?? ''); });
    let gate = deferred(), hold = true, failRead = false, overviewReads = 0;
    await page.route('**/api/system/network-overview', async route => {
        overviewReads++;
        if (hold) await gate.promise;
        return failRead ? route.fulfill({ status: 503, json: { error: 'Lettura sintetica indisponibile' } }) : route.continue();
    });
    const value = page.getByTestId('settings-network-mode-value'), action = page.getByTestId('settings-network-mode-action');
    const capture = async (state: string) => {
        if (causal) return;
        if (directory) await mkdir(directory, { recursive: true });
        for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
            if (size.startsWith('zoom-')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4); else await page.setViewportSize({ width: Number(size), height: 1000 });
            await page.getByRole('button', { name: theme === 'giorno' ? 'Tema Chiaro' : 'Tema Scuro', exact: true }).click();
            await value.scrollIntoViewIfNeeded();
            await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: 'indice', selector: '[data-testid="settings-overview-section"]' }]);
            if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-${state}.png`, animations: 'disabled' });
            surfaces.push({ theme, size, state, cssWidth: await page.evaluate(() => innerWidth) });
        }
        await zoom.setZoom(1); await page.setViewportSize({ width: 1440, height: 1000 });
    };
    try {
        await bootstrapUnlockedSession(page, '1234');
        expect(await page.evaluate(async () => (await fetch('/api/settings/network.mode', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'local-only' }) })).ok)).toBe(true);
        writes.length = 0;
        await page.goto('/settings');
        await expect(action).toBeDisabled(); await expect(value).toContainText('Lettura');
        await capture('lettura'); hold = false; gate.release();
        await expect(action).toBeEnabled();
        const original = await page.request.get('/api/system/network-overview'); expect(original.ok()).toBe(true);
        const from = (await original.json()).session.operatingMode as string;
        expect(from).toBe('local-only');
        await expect(value).toContainText('Locale');
        await expect(page.locator('[data-settings-primary="true"]')).toHaveCount(baseline ? 2 : 1);
        await capture('indice');
        const details = page.locator('summary, [data-disclosure-control]').filter({ hasText: 'Dettagli della connessione' });
        await details.focus(); await expect(details).toBeFocused(); await page.keyboard.press('Enter');
        await expect(page.getByTestId('settings-focus-section').getByText(/Esportazione e backup restano percorsi separati ed espliciti\./u).last()).toBeVisible();
        await expect(page.getByTestId('settings-focus-section')).toContainText('Esportazione e backup restano percorsi separati ed espliciti.');
        await capture('dettagli'); await details.click();
        await action.focus(); await expect(action).toBeFocused();
        await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Apri diagnostica', exact: true })).toBeFocused();
        gate = deferred(); hold = true; overviewReads = 0;
        let committed: unknown;
        await page.route('**/api/settings/network.mode', async route => {
            const response = await route.fetch(); expect(response.ok()).toBe(true);
            committed = await response.json();
            await route.abort('connectionreset');
        });
        await action.click();
        if (baseline && !causal) {
            await expect(page.getByText('La modalità non è cambiata. Riprova dalla diagnostica.', { exact: true })).toBeVisible();
            await expect(value).toContainText('Locale'); await expect(action).toBeEnabled();
        } else {
            await expect(page.getByText('Esito del cambio non verificato. Rileggo la modalità corrente.', { exact: true })).toBeVisible();
            await expect(value).toContainText('Non verificata'); await expect(value).not.toContainText('Locale'); await expect(action).toBeDisabled();
        }
        const readback = await page.request.get('/api/system/network-overview'); expect(readback.ok()).toBe(true);
        const actualMode = (await readback.json()).session.operatingMode;
        expect(actualMode).toBe('network-home-base'); expect(writes).toHaveLength(1);
        if (directory) await writeFile(`${directory}/lost-response-receipt.json`, JSON.stringify({ from, actualMode, committed, writes, observedValue: await value.innerText() }, null, 2));
        await capture('risposta-persa'); hold = false; gate.release();
        if (!baseline) { await expect(value).toContainText('Home-base'); await expect(action).toBeEnabled(); expect(writes).toHaveLength(1); expect(overviewReads).toBe(1); }
        await page.unroute('**/api/settings/network.mode');
        // Reset only the owned fixture through the same real writer.
        expect(await page.evaluate(async () => (await fetch('/api/settings/network.mode', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'local-only' }) })).ok)).toBe(true);
        failRead = true; await page.reload();
        await expect(value).toContainText('Non disponibile'); await expect(action).toBeDisabled();
        await capture('indisponibile'); failRead = false;
        expect(errors).toEqual([]);
        if (directory) await writeFile(`${directory}/surfaces.json`, JSON.stringify({ surfaces, errors, writes }, null, 2));
    } finally { hold = false; gate.release(); await zoom.close(); }
});

test('Indice Impostazioni: diniego reale, ricevuta positiva e riconciliazione non disponibile', async ({ baseURL }) => {
    test.setTimeout(90_000); requireSynthetic(baseURL);
    const zoom = await openBrowserZoomFixture(baseURL!), page = zoom.page;
    await protect(page, baseURL!);
    const directory = process.env.SETTINGS_INDEX_SCREENSHOTS;
    const writes: string[] = [], errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/settings/network.mode') writes.push(request.postData() ?? ''); });
    let responseGate = deferred(), putArrived = deferred();
    let scenario: 'denied' | 'confirmed' | 'unknown' = 'denied';
    let overviewReads = 0;
    const capture = async (state: string) => {
        if (!directory) return;
        await mkdir(directory, { recursive: true });
        for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '390', 'zoom-400']) {
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
            if (size === 'zoom-400') await zoom.setZoom(4); else await page.setViewportSize({ width: Number(size), height: 1000 });
            await page.getByRole('button', { name: theme === 'giorno' ? 'Tema Chiaro' : 'Tema Scuro', exact: true }).click();
            await page.getByTestId('settings-network-mode-value').scrollIntoViewIfNeeded();
            await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }]);
            await page.screenshot({ path: `${directory}/${theme}-${size}-${state}.png`, animations: 'disabled' });
        }
        await zoom.setZoom(1); await page.setViewportSize({ width: 1440, height: 1000 });
    };
    try {
        await bootstrapUnlockedSession(page, '1234');
        expect(await page.evaluate(async () => (await fetch('/api/settings/network.mode', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'local-only' }) })).ok)).toBe(true);
        await page.goto('/settings');
        const value = page.getByTestId('settings-network-mode-value'), action = page.getByTestId('settings-network-mode-action');
        await expect(value).toContainText('Locale'); writes.length = 0;
        const denials: unknown[] = [];
        await page.route('**/api/settings/network.mode', async route => {
            if (scenario === 'denied') {
                const response = await route.fetch({ postData: '{}' });
                expect(response.status()).toBe(400); denials.push(await response.json());
                return route.fulfill({ response });
            }
            const response = await route.fetch(); expect(response.ok()).toBe(true);
            putArrived.release(); await responseGate.promise;
            return scenario === 'unknown' ? route.abort('connectionreset') : route.fulfill({ response });
        });
        await action.click();
        await expect(page.getByText('La richiesta è stata rifiutata. La modalità non è cambiata.', { exact: true })).toBeVisible();
        await expect(value).toContainText('Locale'); await expect(action).toBeEnabled();
        expect((await (await page.request.get('/api/system/network-overview')).json()).session.operatingMode).toBe('local-only');
        expect(writes).toHaveLength(1); await capture('diniego');
        scenario = 'confirmed'; writes.length = 0;
        await page.route('**/api/system/network-overview', route => { overviewReads++; return route.fulfill({ status: 503, json: { error: 'Dettagli sintetici indisponibili' } }); });
        await action.click(); await putArrived.promise;
        await expect(action).toHaveText('Aggiornamento'); await expect(action).toBeDisabled();
        await capture('aggiornamento'); responseGate.release();
        await expect(value).toContainText('Home-base');
        await expect(page.getByText('Modalità aggiornata. I dettagli del nodo non sono ancora disponibili.', { exact: true })).toBeVisible();
        await expect(action).toBeEnabled(); expect(writes).toHaveLength(1); expect(overviewReads).toBe(1);
        await capture('ricevuta-senza-dettagli');
        scenario = 'unknown'; writes.length = 0; overviewReads = 0; responseGate = deferred(); putArrived = deferred();
        await action.click(); await putArrived.promise; responseGate.release();
        await expect(value).toContainText('Non verificata');
        await expect(page.getByText('Esito del cambio non verificato. La modalità corrente non è disponibile. Verificala dalla diagnostica.', { exact: true })).toBeVisible();
        await expect(value).not.toContainText('Home-base'); await expect(value).not.toContainText('Locale'); await expect(action).toBeDisabled();
        expect(writes).toHaveLength(1); expect(overviewReads).toBe(1);
        const readback = await page.request.get('/api/system/network-overview'); expect(readback.ok()).toBe(true);
        expect((await readback.json()).session.operatingMode).toBe('local-only');
        await capture('riconciliazione-indisponibile');
        if (directory) await writeFile(`${directory}/update-states-receipt.json`, JSON.stringify({ denials, writes, overviewReads, errors, actualMode: 'local-only' }, null, 2));
        await page.unroute('**/api/system/network-overview'); await page.unroute('**/api/settings/network.mode');
        await page.reload(); await expect(value).toContainText('Locale');
        const overview = page.getByTestId('settings-overview-section');
        await expect(overview.getByRole('heading', { level: 1 })).toHaveCount(0);
        await expect(overview.getByRole('heading', { name: 'Postazione', level: 2, exact: true })).toHaveCSS('font-size', '12px');
        await expect(overview.getByRole('heading', { name: 'Aspetto', level: 2, exact: true })).toHaveCSS('font-size', '12px');
        const appearance = overview.getByRole('link', { name: 'Apri aspetto', exact: true });
        await appearance.focus(); await expect(appearance).toBeFocused(); await page.keyboard.press('Enter'); await expect(page).toHaveURL(/\/settings\/aspetto$/u);
        await page.goBack(); await expect(value).toContainText('Locale');
        const profile = page.getByTestId('settings-overview-link-profilo'); await profile.focus(); await page.keyboard.press('Enter'); await expect(page).toHaveURL(/\/settings\/profilo$/u);
        expect(errors).toEqual([]);
    } finally { responseGate.release(); await zoom.close(); }
});

test('Indice Impostazioni: tastiera e bersagli in compatto e zoom reale', async ({ baseURL }) => {
    test.setTimeout(90_000); requireSynthetic(baseURL);
    const zoom = await openBrowserZoomFixture(baseURL!), page = zoom.page;
    await protect(page, baseURL!);
    const writes: string[] = [];
    page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/settings/network.mode') writes.push(request.url()); });
    try {
        await bootstrapUnlockedSession(page, '1234'); await page.goto('/settings');
        const action = page.getByTestId('settings-network-mode-action'); await expect(action).toBeEnabled();
        const details = page.getByRole('button', { name: 'Dettagli della connessione', exact: true });
        const diagnostic = page.getByRole('link', { name: 'Apri diagnostica', exact: true });
        const directory = process.env.SETTINGS_INDEX_SCREENSHOTS;
        for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
            if (size.startsWith('zoom-')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4); else await page.setViewportSize({ width: Number(size), height: 1000 });
            await page.getByRole('button', { name: theme === 'giorno' ? 'Tema Chiaro' : 'Tema Scuro', exact: true }).click();
            await details.focus(); await expect(details).toBeFocused(); await page.keyboard.press('Enter'); await expect(details).toHaveAttribute('aria-expanded', 'true');
            await page.keyboard.press('Enter'); await expect(details).toHaveAttribute('aria-expanded', 'false');
            await page.keyboard.press('Tab'); await expect(action).toBeFocused();
            await page.keyboard.press('Tab'); await expect(diagnostic).toBeFocused();
            await diagnostic.evaluate(element => element.scrollIntoView({ block: 'center' }));
            expect(await diagnostic.evaluate(element => { const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return { height: box.height, width: box.width, reachable: hit === element || element.contains(hit) }; })).toMatchObject({ reachable: true });
            const minimum = await page.evaluate(() => innerWidth <= 700 || matchMedia('(pointer: coarse)').matches ? 44 : 40);
            const box = await diagnostic.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(minimum); expect(box!.width).toBeGreaterThanOrEqual(44);
            await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }]);
            if (directory) { await mkdir(directory, { recursive: true }); await page.screenshot({ path: `${directory}/${theme}-${size}-tastiera.png`, animations: 'disabled' }); }
        }
        const appearance = page.getByRole('link', { name: 'Apri aspetto', exact: true });
        await appearance.focus(); await page.keyboard.press('Enter'); await expect(page).toHaveURL(/\/settings\/aspetto$/u);
        expect(writes).toEqual([]);
    } finally { await zoom.close(); }
});
