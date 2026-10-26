import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow } from './utils';

const baseline = process.env.BACKUP_COMPOSITION_BASELINE === '1';

test('Backup: composizione, tastiera, bozza di conferma e verifica senza ripristino', async ({ baseURL }) => {
    test.setTimeout(180_000);
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000') throw new Error('Runtime e archivio sintetici isolati richiesti');
    const directory = process.env.BACKUP_COMPOSITION_SCREENSHOTS, causal = process.env.BACKUP_COMPOSITION_CAUSAL === '1';
    const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
    await page.route('**/api/siss/session-status', route => route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } }));
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
    const errors: string[] = [], forbidden: string[] = [], schedulerPosts: unknown[] = [], surfaces: unknown[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && (/\/api\/(ai|visit-session)\//u.test(request.url()) || new URL(request.url()).pathname === '/api/system/backup-restore')) forbidden.push(request.url()); });
    const schedule = { supported: true, installed: false, plistPath: null, state: { config: { enabled: false, hour: 2, minute: 0, destinationDir: `${process.env.MEDIFLOW_DATA_DIR}/invented-backups`, retentionKeepArtifacts: 14 }, run: { lastRunAt: null, lastRunStatus: null, lastRunMessage: null, lastArtifactPath: null, lastRetentionAt: null, lastRetentionDeletedCount: null, lastRetentionDeletedBytes: null, lastRetentionMode: null } } };
    let release!: () => void, loading = true, failRead = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/system/backup-scheduler', async route => {
        if (route.request().method() !== 'GET') { schedulerPosts.push(route.request().postDataJSON()); return route.fulfill({ status: 503, json: { error: 'Esito sintetico non confermato. Rileggi lo stato prima di ripetere.' } }); }
        if (loading) await gate;
        return failRead ? route.fulfill({ status: 503, json: { error: 'Stato sintetico indisponibile' } }) : route.fulfill({ json: schedule });
    });
    const capture = async (state: string) => {
        if (causal) return;
        if (directory) await mkdir(directory, { recursive: true });
        for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
            if (size.startsWith('zoom-')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4); else await page.setViewportSize({ width: Number(size), height: 1000 });
            await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.classList.toggle('light', theme === 'giorno'); }, theme);
            const anchor = state === 'apertura' ? page.getByRole('heading', { name: 'Backup e ripristino', exact: true }) : state === 'lettura' ? baseline ? page.getByRole('button', { name: 'Salva schedulazione', exact: true }) : page.getByText('Lettura della pianificazione…', { exact: true }) : state === 'esito-non-confermato' ? page.getByText('Esito sintetico non confermato. Rileggi lo stato prima di ripetere.', { exact: true }) : state === 'lettura-indisponibile' ? page.getByText('Stato sintetico indisponibile', { exact: true }) : state === 'conferma' ? page.getByTestId('restore-confirmation-input') : state === 'pianificazione' ? page.getByRole('button', { name: 'Salva schedulazione', exact: true }) : page.getByRole('heading', { name: 'Backup completo di recupero', exact: true });
            await anchor.evaluate(element => element.scrollIntoView({ block: 'center' }));
            if (state === 'conferma') {
                await page.getByTestId('restore-confirmation-input').focus(); await page.keyboard.press('Tab');
                const cancel = page.getByTestId('restore-confirmation-panel').getByRole('button', { name: 'Annulla', exact: true });
                await expect(cancel).toBeFocused(); await cancel.evaluate(element => element.scrollIntoView({ block: 'center' }));
                expect(await cancel.evaluate(element => { const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return element === hit || element.contains(hit); })).toBe(true);
                const box = await cancel.boundingBox(); const minimum = await page.evaluate(() => innerWidth <= 700 || matchMedia('(pointer: coarse)').matches ? 44 : 40); expect(box!.height).toBeGreaterThanOrEqual(minimum);
            }
            await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: 'backup', selector: '[data-testid="settings-backup-section"]' }]);
            if (directory) await page.screenshot({ path: `${directory}/${theme}-${size}-${state}.png`, animations: 'disabled' });
            surfaces.push({ theme, size, state, cssWidth: await page.evaluate(() => innerWidth) });
        }
        await zoom.setZoom(1); await page.setViewportSize({ width: 1440, height: 1000 });
    };
    try {
        await bootstrapUnlockedSession(page, '1234'); await page.goto('/settings/backup');
        const region = page.getByTestId('settings-backup-section'); await expect(region).toBeVisible();
        await capture('apertura');
        if (!baseline) await page.getByRole('button', { name: 'Backup automatici', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Salva schedulazione', exact: true })).toBeDisabled();
        if (!baseline) await expect(region.getByRole('status').filter({ hasText: 'Lettura' })).toBeVisible();
        await capture('lettura');
        loading = false; release();
        const destination = page.getByRole('textbox', { name: 'Destinazione', exact: true });
        await expect(destination).toHaveValue(schedule.state.config.destinationDir);
        await destination.fill(`${process.env.MEDIFLOW_DATA_DIR}/bozza-destinazione-inventata`);
        await page.getByLabel('Orario', { exact: true }).fill('04:30');
        await capture('pianificazione');
        if (!baseline) {
            await expect(region.locator('[data-backup-primary="true"]')).toHaveCount(1);
            await expect(page.getByRole('button', { name: 'Salva schedulazione', exact: true })).toHaveAttribute('data-backup-primary', 'true');
            await page.getByRole('button', { name: 'Backup automatici', exact: true }).click();
            await expect(destination).toBeHidden(); await page.getByRole('button', { name: 'Backup automatici', exact: true }).click();
            await expect(destination).toHaveValue(`${process.env.MEDIFLOW_DATA_DIR}/bozza-destinazione-inventata`); await expect(page.getByLabel('Orario', { exact: true })).toHaveValue('04:30');
        }
        const verify = page.getByTestId('backup-verify-input');
        if (!baseline || causal) { await verify.focus(); await expect(verify).toBeFocused(); const chooser = page.waitForEvent('filechooser', { timeout: 10_000 }); await page.keyboard.press('Space'); const selected = await chooser; expect(selected.isMultiple()).toBe(false); await selected.setFiles([]); }
        const artifact = await (await page.request.get('/api/system/backup-restore')).text();
        await verify.setInputFiles({ name: 'backup-inventato.mediflow', mimeType: 'application/json', buffer: Buffer.from(artifact) });
        const outcome = page.getByTestId('backup-outcome'); await expect(outcome).toContainText('Backup verificato'); await expect(outcome).toContainText('Verificato non significa provato');
        const restore = page.getByText('Seleziona file .mediflow v1', { exact: true }).locator('input');
        if (!baseline) { await restore.focus(); await expect(restore).toBeFocused(); const chooser = page.waitForEvent('filechooser', { timeout: 10_000 }); await page.keyboard.press('Space'); await (await chooser).setFiles([]); }
        await restore.setInputFiles({ name: 'backup-inventato.mediflow', mimeType: 'application/json', buffer: Buffer.from(artifact) });
        const panel = page.getByTestId('restore-confirmation-panel'), keyword = page.getByTestId('restore-confirmation-input'), submit = page.getByTestId('restore-confirmation-submit');
        await expect(panel).toBeVisible();
        if (!baseline) { await expect(panel).toContainText('Account e chiavi restano invariati.'); await expect(panel).toContainText('Lo storico protetto delle operazioni viene conservato.'); await expect(region).not.toContainText('TUTTI i dati'); }
        await expect(submit).toBeDisabled(); await keyword.fill('RIPRI'); await expect(submit).toBeDisabled();
        await capture('conferma');
        if (!baseline) { await expect(region.locator('[data-backup-primary="true"]')).toHaveCount(1); await expect(panel.getByRole('button', { name: 'Annulla', exact: true })).toHaveAttribute('data-backup-primary', 'true'); }
        await keyword.fill(' ripristina '); await expect(submit).toBeEnabled();
        if (!baseline) { await keyword.focus(); await page.keyboard.press('Tab'); await expect(panel.getByRole('button', { name: 'Annulla', exact: true })).toBeFocused(); await page.keyboard.press('Enter'); }
        else await panel.getByRole('button', { name: 'Annulla', exact: true }).click();
        await expect(panel).toHaveCount(0);
        expect(schedulerPosts).toEqual([]);
        const save = page.getByRole('button', { name: 'Salva schedulazione', exact: true });
        await save.click();
        await expect(page.getByText('Esito sintetico non confermato. Rileggi lo stato prima di ripetere.', { exact: true })).toBeVisible();
        await expect(save).toBeDisabled(); await expect(page.getByText('Stato non confermato', { exact: true })).toBeVisible();
        await expect(destination).toHaveValue(`${process.env.MEDIFLOW_DATA_DIR}/bozza-destinazione-inventata`);
        expect(schedulerPosts).toHaveLength(1); expect(schedulerPosts[0]).toMatchObject({ action: 'save', config: { hour: 4, minute: 30, retentionKeepArtifacts: 14 } });
        await capture('esito-non-confermato');
        failRead = true; await page.getByRole('button', { name: 'Rileggi stato', exact: true }).click();
        await expect(page.getByText('Stato sintetico indisponibile', { exact: true })).toBeVisible(); await expect(save).toBeDisabled();
        if (!baseline) { await expect(destination).toBeHidden(); await expect(region.getByRole('alert').filter({ hasText: 'Pianificazione non disponibile' })).toBeVisible(); }
        await capture('lettura-indisponibile'); failRead = false;
        await page.getByRole('button', { name: 'Rileggi stato', exact: true }).click(); await expect(destination).toHaveValue(schedule.state.config.destinationDir); await expect(save).toBeEnabled();
        expect(schedulerPosts).toHaveLength(1); expect(forbidden).toEqual([]); expect(errors).toEqual([]);
        if (directory) await writeFile(`${directory}/receipt.json`, JSON.stringify({ surfaces, schedulerPosts, forbidden, errors, restoreSubmitted: false }, null, 2));
    } finally { release(); await zoom.close(); }
});
