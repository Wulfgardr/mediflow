import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow } from './utils';
async function installMaintenanceMocks(page: Page, baseURL: string) {
    const origin = new URL(baseURL).origin;
    if (new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000')
        throw Error('Synthetic loopback required');
    const rows = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Ambulatorio Uno inventato', address: 'Via inventata 1', parentId: null, type: 'live', isDefault: true, version: 1, createdAt: '2026-10-27T00:00:00Z' },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Reparto inventato', address: '', parentId: '11111111-1111-4111-8111-111111111111', type: 'test', isDefault: false, version: 1, createdAt: '2026-10-27T00:00:00Z' },
        { id: '33333333-3333-4333-8333-333333333333', name: 'Ambulatorio Due inventato', address: '', parentId: null, type: 'test', isDefault: false, version: 1, createdAt: '2026-10-27T00:00:00Z' }];
    const state = { readStatus: 200 as 200 | 401 | 403, versionAbsent: false, holdWrite: null as Promise<void> | null, holdRead: null as Promise<void> | null, readError: false, defaultError: false, failNextRead: false, native: 'ack' as 'ack' | 'error', reset: 'commitfailed' as 'commitfailed' | 'abort', holdNative: null as Promise<void> | null, holdPatient: null as Promise<void> | null };
    const calls: Array<{
        method: string;
        path: string;
        body?: unknown;
        mock: boolean;
    }> = [], allBlocked: Array<{
        method: string;
        path?: string;
        url?: string;
    }> = [];
    const handler = async (route: import('@playwright/test').Route) => {
        const req = route.request(), u = new URL(req.url()), p = u.pathname, m = req.method();
        if (u.origin !== origin) {
            allBlocked.push({ method: m, url: req.url() });
            return route.abort();
        }
        if (p === '/api/siss/session-status')
            return route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } });
        if (p.startsWith('/api/ai/') || p.startsWith('/api/icd/')) {
            allBlocked.push({ method: m, path: p });
            return route.abort();
        }
        if (p === '/api/ambulatories' || p.startsWith('/api/ambulatories/')) {
            calls.push({ method: m, path: p, body: req.postDataJSON(), mock: true });
            if (m === 'GET') {
                if (state.holdRead)
                    await state.holdRead;
                if (state.readStatus !== 200) return route.fulfill({ status: state.readStatus, json: { error: 'SYNTHETIC AUTH UNAVAILABLE' } });
                return state.readError ? route.fulfill({ status: 503, json: { error: 'SYNTHETIC READ DENIED' } }) : route.fulfill({ json: state.versionAbsent ? rows.map(row => ({ ...row, version: undefined })) : rows });
            }
            const data = req.postDataJSON() || {};
            if (m === 'POST' && p === '/api/ambulatories') {
                rows.push({ ...data, version: 1 });
                return route.fulfill({ status: 201, json: { id: data.id, version: 1 } });
            }
            if (m === 'PUT') {
                if (state.holdWrite)
                    await state.holdWrite;
                if (state.defaultError)
                    return route.fulfill({ status: 503, json: { error: 'SYNTHETIC DEFAULT DENIED' } });
                const row = rows.find(x => p.endsWith('/' + x.id));
                if (row) {
                    if (data.isDefault)
                        rows.forEach(x => x.isDefault = false);
                    Object.assign(row, data, { version: row.version + 1 });
                }
                if (state.failNextRead)
                    state.readError = true;
                return route.fulfill({ json: { success: true, version: row?.version } });
            }
            return route.fulfill({ status: 409, json: { error: 'SYNTHETIC DESTRUCTIVE DENIED' } });
        }
        if (p === '/api/system/native') {
            calls.push({ method: m, path: p, mock: true });
            if (state.holdNative)
                await state.holdNative;
            return state.native === 'ack' ? route.fulfill({ json: { success: true } }) : route.fulfill({ status: 500, json: { error: 'SYNTHETIC NATIVE DENIED' } });
        }
        if (p === '/api/auth/reset') {
            calls.push({ method: m, path: p, mock: true });
            return state.reset === 'abort' ? route.abort() : route.fulfill({ status: 500, json: { success: false, code: 'RESET_AUTHORITY_COMMIT_FAILED', error: 'SYNTHETIC COMMIT UNKNOWN' } });
        }
        if (/^\/api\/(patients|entries|therapies|checkups|attachments|conversations|messages)(?:\/|$)/.test(p)) {
            calls.push({ method: m, path: p, mock: true });
            if (m === 'GET')
                return route.fulfill({ json: [] });
            if (state.holdPatient)
                await state.holdPatient;
            return route.fulfill({ status: 503, json: { error: 'SYNTHETIC DATA WRITE DENIED' } });
        }
        return route.continue();
    };
    await page.route('**/*', handler);
    return { state, rows, calls, allBlocked, close: () => page.unroute('**/*', handler) };
}
test('Settings maintenance: scopes, canceled effects and uncertain reset', async ({ baseURL }, info) => {
    test.setTimeout(120000);
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR)
        throw Error('Synthetic runtime required');
    const zoom = await openBrowserZoomFixture(baseURL!), page = zoom.page, f = await installMaintenanceMocks(page, baseURL!);
    const directory = process.env.SETTINGS_MAINTENANCE_SCREENSHOTS, captureDirectory = directory || process.env.SETTINGS_MAINTENANCE_STATE_SCREENSHOTS, frames: unknown[] = [], errors: string[] = [];
    let releaseNative = () => { }, releasePatient = () => { }, releaseRead = () => { }, releaseWrite = () => { };
    page.on('pageerror', e => errors.push(e.message));
    const shot = async (name: string, target: Locator) => { await target.scrollIntoViewIfNeeded(); const probe = await target.evaluate(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e), root = getComputedStyle(document.documentElement), hit = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(20, r.height / 2)); return { text: e.textContent, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, viewport: { width: innerWidth, height: innerHeight }, centerHit: hit === e || e.contains(hit), fontSize: s.fontSize, palette: { ink: root.getPropertyValue('--lume-ink'), surface: root.getPropertyValue('--lume-surface-field'), color: s.color }, active: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent }; }); expect(probe.centerHit).toBe(true); frames.push({ name, ...probe }); if (captureDirectory) {
        await mkdir(captureDirectory, { recursive: true });
        await page.screenshot({ path: captureDirectory + '/' + name + '.png', fullPage: false, animations: 'disabled' });
    } return probe; };
    const mutationCount = () => f.calls.filter(x => x.method !== 'GET').length;
    const cancel = async (name: string, invoke: () => Promise<void>) => { const n = mutationCount(); await invoke(); const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible(); if (name === 'cleanup-full-cancel') await expect(dialog).toContainText('Elimina tutti i pazienti, inclusi quelli reali, e tutte le voci, terapie, controlli, allegati, conversazioni e messaggi.'); await shot(name, dialog.getByRole('heading')); await dialog.getByRole('button', { name: 'Annulla', exact: true }).click(); await expect(dialog).toHaveCount(0); expect(mutationCount()).toBe(n); };
    const rowAction = async (row: Locator, name: string) => { await row.getByRole('button', { name: 'Azioni', exact: true }).click(); await page.getByRole('menu', { name: 'Azioni', exact: true }).getByRole('menuitem', { name, exact: true }).click(); };
    try {
        if (!directory && captureDirectory) await page.addInitScript(() => localStorage.setItem('mediflow-theme', 'dark'));
        await bootstrapUnlockedSession(page, '1234');
        for (const route of ['ambulatories', 'sviluppo', 'zona-pericolo']) {
            await page.goto('/settings/' + route);
            const surface = page.getByTestId(route === 'ambulatories' ? 'settings-ambulatories-section' : route === 'sviluppo' ? 'settings-development-section' : 'settings-danger-zone-section');
            await expect(surface).toBeVisible();
            if (route === 'ambulatories')
                await expect(page.getByRole('treeitem')).toHaveCount(3);
            if (directory) {
                const palette = new Map<string, string>();
                for (const theme of ['giorno', 'grafite'])
                    for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
                        await page.setViewportSize({ width: 1440, height: 1000 });
                        await zoom.setZoom(1);
                        if (size.startsWith('zoom-'))
                            await zoom.setZoom(size === 'zoom-200' ? 2 : 4);
                        else
                            await page.setViewportSize({ width: Number(size), height: 1000 });
                        await page.evaluate(theme => { const v = theme === 'giorno' ? 'light' : 'dark'; localStorage.setItem('mediflow-theme', v); document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(v); document.documentElement.style.colorScheme = v; }, theme);
                        await assertNoHorizontalOverflow(page, [{ label: route, selector: 'document' }]);
                        const probe = await shot(route + '-' + theme + '-' + size, surface.locator('h2').first());
                        expect(probe.fontSize).toBe('12px');
                        if (size === '1440')
                            palette.set(theme, probe.palette.color);
                    }
                expect(palette.get('giorno')).not.toBe(palette.get('grafite'));
                await zoom.setZoom(1);
                await page.setViewportSize({ width: 1440, height: 1000 });
            }
        }
        await page.goto('/settings/ambulatories');
        await expect(page.getByRole('treeitem')).toHaveCount(3);
        const testRow = page.getByRole('treeitem').filter({ has: page.getByRole('heading', { name: 'Ambulatorio Due inventato', exact: true }) });
        await cancel('clear-cancel', () => rowAction(testRow, 'Svuota ambiente di test'));
        await expect(testRow.getByRole('button', { name: 'Azioni', exact: true })).toBeFocused();
        await cancel('delete-cancel', () => rowAction(testRow, 'Elimina sede'));
        const name = page.getByLabel('Nome', { exact: true }), address = page.getByLabel('Indirizzo (opzionale)', { exact: true });
        await name.fill('Bozza inventata');
        await address.fill('Indirizzo inventato');
        f.state.defaultError = true;
        f.state.holdWrite = new Promise<void>(resolve => releaseWrite = resolve);
        const denied = page.waitForResponse(r => r.request().method() === 'PUT' && r.status() === 503);
        await rowAction(testRow, 'Usa come predefinita');
        await expect(testRow.getByRole('button', { name: 'Azioni', exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Aggiungi', exact: true })).toBeDisabled();
        releaseWrite();
        await denied;
        await expect(page.getByTestId('settings-ambulatories-section').getByRole('alert')).toContainText('Impossibile aggiornare l’ambulatorio predefinito.');
        await expect(page.getByRole('treeitem')).toHaveCount(3);
        await expect(testRow.getByRole('button', { name: 'Azioni', exact: true })).toBeDisabled();
        await expect(name).toHaveValue('Bozza inventata');
        await shot('default-denied', page.getByTestId('settings-ambulatories-section').getByRole('alert'));
        f.state.defaultError = false;
        await page.getByRole('button', { name: 'Riprova', exact: true }).click();
        await expect(testRow.getByRole('button', { name: 'Azioni', exact: true })).toBeEnabled();
        f.state.failNextRead = true;
        await rowAction(testRow, 'Usa come predefinita');
        await expect(page.getByText('Ambulatorio predefinito aggiornato.', { exact: true })).toBeVisible();
        await expect(page.getByTestId('settings-ambulatories-section').getByRole('alert')).toContainText('Impossibile leggere gli ambulatori.');
        await expect(page.getByTestId('settings-ambulatories-section').getByRole('alert')).toContainText('L’elenco mostrato potrebbe non essere aggiornato.');
        await expect(page.getByRole('treeitem')).toHaveCount(3);
        await expect(name).toHaveValue('Bozza inventata');
        f.state.failNextRead = false;
        f.state.readError = false;
        await page.getByRole('button', { name: 'Riprova', exact: true }).click();
        await expect(testRow).toHaveAttribute('aria-selected', 'true');
        await expect(address).toHaveValue('Indirizzo inventato');
        await name.fill('Sede nuova inventata');
        await page.getByRole('button', { name: 'Aggiungi', exact: true }).click();
        await expect(page.getByRole('treeitem')).toHaveCount(4);
        await expect(page.getByText('Ambulatorio creato.', { exact: true })).toBeVisible();
        const newRow = page.getByRole('treeitem').filter({ has: page.getByRole('heading', { name: 'Sede nuova inventata', exact: true }) });
        await newRow.getByRole('button', { name: 'Aggiungi reparto sotto Sede nuova inventata', exact: true }).click();
        await expect(name).toBeFocused();
        await name.fill('Reparto nuovo inventato');
        await page.getByRole('button', { name: 'Aggiungi', exact: true }).click();
        const child = page.getByRole('treeitem').filter({ has: page.getByRole('heading', { name: 'Reparto nuovo inventato', exact: true }) });
        await expect(child).toHaveAttribute('aria-level', '2');
        await expect(child).toContainText('Reparto di Sede nuova inventata');
        for (const status of [401, 403] as const) {
            f.state.readStatus = status;
            const deniedList = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ambulatories' && response.status() === status);
            await page.goto('/settings/ambulatories');
            await deniedList;
            await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
            await expect(page.getByText('Nessuna sede configurata.', { exact: true })).toHaveCount(0);
            f.state.readStatus = 200;
            await bootstrapUnlockedSession(page, '1234');
            await page.goto('/settings/ambulatories');
            await expect(page.getByRole('treeitem')).toHaveCount(5);
        }
        f.state.versionAbsent = true;
        await page.goto('/settings/ambulatories');
        await expect(testRow).toBeVisible();
        await name.fill('Bozza senza versione');
        const beforeMissingVersion = mutationCount();
        await rowAction(testRow, 'Svuota ambiente di test');
        await page.getByRole('dialog').getByRole('button', { name: 'Svuota', exact: true }).click();
        await expect(page.getByTestId('settings-ambulatories-section').getByRole('alert')).toContainText('Versione della sede non disponibile. Aggiorna la pagina e riprova.');
        expect(mutationCount()).toBe(beforeMissingVersion);
        await expect(testRow.getByRole('button', { name: 'Azioni', exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Aggiungi', exact: true })).toBeDisabled();
        f.state.versionAbsent = false;
        await page.getByRole('button', { name: 'Riprova', exact: true }).click();
        await expect(testRow.getByRole('button', { name: 'Azioni', exact: true })).toBeEnabled();
        await expect(name).toHaveValue('Bozza senza versione');
        f.rows.splice(1);
        await page.reload();
        await expect(page.getByText('1 sede configurata.', { exact: true })).toBeVisible();
        await expect(page.getByRole('combobox', { name: 'Sede superiore', exact: true })).toBeVisible();
        f.rows.splice(0);
        f.state.holdRead = new Promise<void>(resolve => releaseRead = resolve);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('settings-ambulatories-section').getByRole('status')).toContainText('Caricamento sedi...');
        await expect(page.getByRole('button', { name: 'Aggiungi', exact: true })).toBeDisabled();
        releaseRead();
        await expect(page.getByText('Nessuna sede configurata.', { exact: true })).toBeVisible();
        await expect(page.getByText('0 sedi configurate.', { exact: true })).toBeVisible();
        f.state.readError = true;
        await page.reload();
        await expect(page.getByTestId('settings-ambulatories-section').getByRole('alert')).toContainText('Impossibile leggere gli ambulatori.');
        await expect(page.getByText('Nessuna sede configurata.', { exact: true })).toHaveCount(0);
        await shot('list-read-denied', page.getByTestId('settings-ambulatories-section').getByRole('alert'));
        await page.goto('/settings/sviluppo');
        const seeder = page.getByTestId('settings-data-seeder'), toggle = seeder.getByRole('button', { name: 'Generatore di dati di test', exact: true });
        await toggle.focus();
        await toggle.press('Enter');
        await expect(toggle).toBeFocused();
        const slider = seeder.getByRole('slider');
        await slider.focus();
        await slider.press('Home');
        await expect(slider).toHaveValue('1');
        await cancel('seed-cancel', () => seeder.getByRole('button', { name: 'Genera', exact: true }).click());
        await cancel('cleanup-test-cancel', () => seeder.getByRole('button', { name: 'Elimina', exact: true }).click());
        await seeder.getByRole('checkbox', { name: 'Eliminazione estesa', exact: true }).check();
        await expect(seeder).toContainText('Elimina tutti i pazienti, inclusi quelli reali, e tutte le voci, terapie, controlli, allegati, conversazioni e messaggi.');
        await cancel('cleanup-full-cancel', () => seeder.getByRole('button', { name: 'Elimina', exact: true }).click());
        await toggle.click();
        await toggle.click();
        await expect(slider).toHaveValue('1');
        await expect(seeder.getByRole('checkbox', { name: 'Eliminazione estesa', exact: true })).toBeChecked();
        f.state.holdPatient = new Promise<void>(resolve => releasePatient = resolve);
        await seeder.getByRole('button', { name: 'Genera', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Genera', exact: true }).click();
        await expect(seeder.getByText('Generazione in corso...', { exact: true })).toBeVisible();
        await shot('seed-pending', seeder.getByRole('status'));
        await toggle.click();
        await expect(seeder.getByRole('status')).toContainText('0 / 1');
        await toggle.click();
        await expect(slider).toHaveValue('1');
        releasePatient();
        await expect(seeder.getByRole('button', { name: 'Genera', exact: true })).toBeEnabled();
        const native = page.getByRole('button', { name: 'Apri applicazione nativa', exact: true });
        f.state.holdNative = new Promise<void>(resolve => releaseNative = resolve);
        await native.click();
        await expect(page.getByRole('button', { name: 'Avvio in corso...', exact: true })).toBeDisabled();
        await shot('native-pending', page.getByRole('button', { name: 'Avvio in corso...', exact: true }));
        releaseNative();
        await expect(page.getByText('Richiesta di apertura inviata.', { exact: true })).toBeVisible();
        await shot('native-ack', page.getByText('Richiesta di apertura inviata.', { exact: true }));
        await expect(page.getByText('Richiesta di apertura inviata.', { exact: true })).toHaveCount(0);
        f.state.native = 'error';
        await native.click();
        await expect(page.getByText('Impossibile inviare la richiesta di apertura.', { exact: true })).toBeVisible();
        await shot('native-error', page.getByText('Impossibile inviare la richiesta di apertura.', { exact: true }));
        await page.goto('/settings/zona-pericolo');
        const field = page.getByTestId('danger-zone-confirm-input'), reset = page.getByTestId('danger-zone-reset-button');
        await expect(reset).toBeDisabled();
        await field.fill('RESET');
        await cancel('reset-cancel', () => reset.click());
        await expect(field).toHaveValue('RESET');
        await reset.click();
        await page.getByRole('dialog').getByRole('button', { name: 'Ripristina configurazione', exact: true }).click();
        await expect(page.getByTestId('settings-danger-zone-section').getByRole('alert')).toContainText('Reset eseguito, ma la chiusura delle sessioni non è stata confermata.');
        await expect(reset).toBeDisabled();
        const n = mutationCount();
        await field.fill('');
        await field.fill('RESET');
        await field.press('Enter');
        await expect(reset).toBeDisabled();
        expect(mutationCount()).toBe(n);
        await expect(page.getByTestId('settings-danger-zone-section').getByRole('link', { name: 'Accesso', exact: true })).toHaveAttribute('href', '/settings/accesso');
        await shot('reset-commit-failed', page.getByTestId('settings-danger-zone-section').getByRole('alert'));
        await page.reload();
        f.state.reset = 'abort';
        await field.fill('RESET');
        await reset.click();
        await page.getByRole('dialog').getByRole('button', { name: 'Ripristina configurazione', exact: true }).click();
        await expect(page.getByTestId('settings-danger-zone-section').getByRole('alert')).toContainText('Esito del reset non confermato. Verifica l’accesso prima di procedere.');
        await expect(reset).toBeDisabled();
        await shot('reset-network-unknown', page.getByTestId('settings-danger-zone-section').getByRole('alert'));
        expect(errors).toEqual([]);
        expect(f.allBlocked).toEqual([]);
    }
    finally {
        releaseNative();
        releasePatient();
        releaseRead();
        releaseWrite();
        try {
            const observation = { frames, errors, calls: f.calls, allBlocked: f.allBlocked };
            await info.attach('settings-maintenance-observations.json', { body: JSON.stringify(observation), contentType: 'application/json' });
            if (captureDirectory) {
                await mkdir(captureDirectory, { recursive: true });
                await writeFile(captureDirectory + '/surfaces.json', JSON.stringify(observation, null, 2));
            }
        }
        finally {
            await page.unrouteAll({ behavior: 'ignoreErrors' });
            await zoom.close();
        }
    }
});
