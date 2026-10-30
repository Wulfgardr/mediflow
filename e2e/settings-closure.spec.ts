import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { bootstrapUnlockedSession, unlockIfNeeded } from './utils';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { closureGallery } from './fixtures/settings-closure-gallery';

function synthetic(baseURL?: string) {
    if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1' || (process.env.SETTINGS_CLOSURE === '1' && new URL(baseURL).port !== '3000')
        || process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR
        || process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY !== '1') throw Error('Archivio sintetico isolato sulla porta 3000 richiesto');
}

test('Profilo: ritorno browser e blocco conservano la bozza senza salvarla', async ({ baseURL }) => {
    test.setTimeout(180_000); synthetic(baseURL);
    const zoom = await openBrowserZoomFixture(baseURL!), page = zoom.page;
    let writes = 0;
    await page.route('**/api/auth/profile', route => {
        if (route.request().method() !== 'GET') { writes++; return route.abort(); }
        return route.continue();
    });
    try {
        await bootstrapUnlockedSession(page, '1234');
        await page.goto(`${baseURL}/settings`);
        await page.getByRole('link', { name: 'Profilo', exact: true }).click();
        const name = page.getByLabel('Nome medico', { exact: true });
        await expect(name).toBeEnabled();
        const original = await name.inputValue();
        await name.fill('Bozza sintetica ritorno browser');
        await page.goBack(); await expect(page).toHaveURL(`${baseURL}/settings`);
        await page.goForward(); await expect(name).toBeEnabled();
        await closureGallery(page, zoom, process.env.SETTINGS_ACCOUNT_SCREENSHOTS, 'profilo-ritorno', name);
        await expect.soft(name).toHaveValue('Bozza sintetica ritorno browser');
        await name.fill('Bozza sintetica dopo blocco');
        await page.getByRole('button', { name: 'Blocca', exact: true }).click();
        await expect(page.getByLabel('MediFlow lock screen', { exact: true })).toBeVisible();
        await expect(name).toHaveCount(0);
        await unlockIfNeeded(page, '1234'); await expect(name).toBeEnabled();
        await closureGallery(page, zoom, process.env.SETTINGS_ACCOUNT_SCREENSHOTS, 'profilo-sblocco', name);
        await expect.soft(name).toHaveValue('Bozza sintetica dopo blocco');
        if (process.env.SETTINGS_CLOSURE_CANDIDATE === '1') {
            const save = page.getByRole('button', { name: 'Salva profilo', exact: true });
            await expect(save).toBeDisabled();
            await page.getByRole('button', { name: 'Rileggi profilo mantenendo la bozza', exact: true }).click();
            await expect(save).toBeEnabled(); await expect(name).toHaveValue('Bozza sintetica dopo blocco');
        }
        const saved = await (await page.request.get(`${baseURL}/api/auth/profile`)).json();
        expect(saved.displayName ?? '').toBe(original); expect(writes).toBe(0);
    } finally { await zoom.close(); }
});

test('Backup: avviso completo e annullamento raggiungibili al 400 percento', async ({ baseURL }) => {
    test.setTimeout(120_000); synthetic(baseURL);
    const zoom = await openBrowserZoomFixture(baseURL!), page = zoom.page;
    const directory = (process.env.BACKUP_COMPOSITION_SCREENSHOTS || test.info().outputPath('screenshots'));
    const frames: unknown[] = []; let writes = 0;
    await page.route('**/api/system/backup-restore', route => {
        if (route.request().method() === 'POST') { writes++; return route.abort(); }
        return route.continue();
    });
    try {
        await bootstrapUnlockedSession(page, '1234'); await page.goto(`${baseURL}/settings/backup`);
        const artifact = await (await page.request.get(`${baseURL}/api/system/backup-restore`)).text();
        await page.getByText('Seleziona file .mediflow v1', { exact: true }).locator('input').setInputFiles({
            name: 'backup-sintetico.mediflow', mimeType: 'application/json', buffer: Buffer.from(artifact) });
        const panel = page.getByTestId('restore-confirmation-panel');
        await expect(panel).toBeVisible();
        const warning = panel.locator('p').first();
        await expect(warning).toContainText('Account e chiavi restano invariati.');
        await expect(warning).toContainText('Lo storico protetto delle operazioni viene conservato.');
        await mkdir(directory, { recursive: true });
        for (const theme of ['giorno', 'grafite']) {
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(4);
            await page.evaluate(theme => {
                document.documentElement.classList.remove('light', 'dark');
                document.documentElement.classList.add(theme === 'giorno' ? 'light' : 'dark');
            }, theme);
            const text = await warning.innerText();
            const height = await page.evaluate(() => innerHeight);
            const covered = new Set<string>(); let lineCount = 0;
            const total = await warning.evaluate(element => element.getBoundingClientRect().height);
            for (let offset = 0; offset < total; offset += 80) {
                await warning.evaluate((element, offset) => {
                    element.scrollIntoView({ block: 'start' });
                    let owner = element.parentElement;
                    while (owner && !(owner.scrollHeight > owner.clientHeight && /auto|scroll/.test(getComputedStyle(owner).overflowY))) owner = owner.parentElement;
                    owner?.scrollBy(0, offset);
                }, offset);
                const lines = await warning.evaluate(element => {
                    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), lines: { key: string; visible: boolean }[] = [];
                    let node: Node | null, index = 0;
                    while ((node = walker.nextNode())) {
                        const range = document.createRange(); range.selectNodeContents(node);
                        for (const [line, r] of Array.from(range.getClientRects()).entries()) {
                            const x = r.x + r.width / 2;
                            lines.push({ key: `${index}-${line}`, visible: [r.y + 1, r.bottom - 1].every(y => {
                                const hit = document.elementFromPoint(x, y);
                                return hit === element || !!hit && element.contains(hit);
                            }) });
                        }
                        index++;
                    }
                    return lines;
                });
                lineCount = lines.length;
                for (const line of lines) if (line.visible) covered.add(line.key);
                const rect = await warning.boundingBox();
                frames.push({ theme, offset, total, height, rect, text });
                await page.screenshot({ path: `${directory}/avviso-${theme}-400-${offset}.png`, animations: 'disabled' });
            }
            expect(covered.size, `Tutte le righe dell’avviso leggibili in ${theme}`).toBe(lineCount);
            await page.setViewportSize({ width: 1440, height: 2160 });
            await warning.evaluate(element => element.scrollIntoView({ block: 'center' }));
            expect(await warning.evaluate(element => {
                const r = element.getBoundingClientRect();
                return [r.y + 1, r.bottom - 1].every(y => {
                    const hit = document.elementFromPoint(r.x + r.width / 2, y);
                    return hit === element || !!hit && element.contains(hit);
                });
            }), 'Avviso intero nel viewport alto dichiarato, senza composizione di immagini').toBe(true);
            await page.screenshot({ path: `${directory}/avviso-${theme}-400-intero-1440x2160.png`, animations: 'disabled' });
            frames.push({ theme, entireWarning: true, viewport: { width: 1440, height: 2160 }, zoom: 4, rect: await warning.boundingBox(), text });
            await page.setViewportSize({ width: 1440, height: 1000 });
            const keyword = page.getByTestId('restore-confirmation-input'), submit = page.getByTestId('restore-confirmation-submit');
            await keyword.fill('RIPRI'); await expect(submit).toBeDisabled();
            await keyword.fill('RIPRISTINA'); await expect(submit).toBeEnabled();
            await keyword.focus(); await page.keyboard.press('Tab');
            const cancel = panel.getByRole('button', { name: 'Annulla', exact: true });
            await expect(cancel).toBeFocused();
            await cancel.scrollIntoViewIfNeeded();
            await page.screenshot({ path: `${directory}/annulla-${theme}-400.png`, animations: 'disabled' });
        }
        await page.keyboard.press('Enter'); await expect(panel).toHaveCount(0); expect(writes).toBe(0);
        await writeFile(`${directory}/avviso-receipt.json`, JSON.stringify({ frames, writes, restoreSubmitted: false }, null, 2));
    } finally { await zoom.close(); }
});
