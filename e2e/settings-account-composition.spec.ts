import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { bootstrapUnlockedSession, unlockIfNeeded, assertNoHorizontalOverflow } from './utils';

function requireSynthetic(baseURL?: string) {
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY !== '1'
        || !process.env.MEDIFLOW_DATA_DIR || !baseURL || new URL(baseURL).hostname !== '127.0.0.1') {
        throw new Error('Isolated synthetic runtime required');
    }
}
async function protect(page: Page, baseURL: string) {
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
    await page.route('**/api/siss/session-status', route => route.fulfill({ json: { status: 'unavailable', source: 'synthetic', checkpoints: [] } }));
}

async function capture(page: Page, zoom: Awaited<ReturnType<typeof openBrowserZoomFixture>>, route: string, target: Locator) {
    const directory = process.env.SETTINGS_ACCOUNT_SCREENSHOTS;
    if (!directory || (route === 'accesso' && process.env.SETTINGS_ACCOUNT_KEEP_ACCESS_GALLERY === '1')) return;
    await mkdir(directory, { recursive: true });
    const surfaces = [];
    for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
        await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
        if (size.startsWith('zoom')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4);
        else await page.setViewportSize({ width: Number(size), height: 1000 });
        await page.evaluate(theme => {
            document.documentElement.classList.toggle('dark', theme === 'grafite');
            document.documentElement.classList.toggle('light', theme === 'giorno');
            document.documentElement.style.colorScheme = theme === 'grafite' ? 'dark' : 'light';
        }, theme);
        await target.evaluate(element => element.scrollIntoView({ block: 'center' }));
        const before = await target.evaluate(element => {
            const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, innerWidth, innerHeight,
                devicePixelRatio, centerVisible: element === hit || element.contains(hit) };
        });
        expect(before.centerVisible).toBe(true);
        expect(before.y).toBeGreaterThanOrEqual(0); expect(before.y + before.height).toBeLessThanOrEqual(before.innerHeight);
        await assertNoHorizontalOverflow(page, [{ label: 'document', selector: 'document' }]);
        const png = await page.screenshot({ path: `${directory}/${route}-${theme}-${size}.png`, fullPage: false, animations: 'disabled' });
        const after = await target.boundingBox();
        expect(after!.x).toBeCloseTo(before.x, 0); expect(after!.y).toBeCloseTo(before.y, 0);
        expect(png.readUInt32BE(16)).toBe(Math.round(before.innerWidth * before.devicePixelRatio));
        expect(png.readUInt32BE(20)).toBe(Math.round(before.innerHeight * before.devicePixelRatio));
        surfaces.push({ route, theme, size, before, after, pngWidth: png.readUInt32BE(16), pngHeight: png.readUInt32BE(20) });
    }
    await writeFile(`${directory}/${route}-surfaces.json`, JSON.stringify(surfaces, null, 2));
    await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
}

async function stateCapture(page: Page, zoom: Awaited<ReturnType<typeof openBrowserZoomFixture>>, name: string, target: Locator) {
    const directory = process.env.SETTINGS_ACCOUNT_SCREENSHOTS;
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    for (const factor of [1, 4]) {
        await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(factor);
        await target.evaluate(element => element.scrollIntoView({ block: 'center' }));
        const bounds = await target.boundingBox();
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
        await page.screenshot({ path: `${directory}/${name}${factor === 4 ? '-zoom400' : ''}.png`, fullPage: false, animations: 'disabled' });
    }
    await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
}

test('access and profile settings preserve form drafts and denied outcomes', async ({ baseURL }) => {
    test.setTimeout(120_000); requireSynthetic(baseURL);
    const zoom = await openBrowserZoomFixture(baseURL!), page = zoom.page;
    const errors: string[] = [];
    const releaseGates: Array<() => void> = [];
    page.on('pageerror', error => errors.push(error.message));
    await protect(page, baseURL!);
    const go = async (path: string) => { await page.goto(new URL(path, baseURL!).href); await unlockIfNeeded(page, '1234'); };
    try {
        const originalGoto = page.goto.bind(page);
        page.goto = (url, options) => originalGoto(new URL(url, baseURL!).href, options);
        await bootstrapUnlockedSession(page, '1234');
        await go('/settings/accesso');
        const access = page.getByTestId('settings-access-section');
        const primary = access.locator('button:is(.mf-button-primary, [class*="primaryAction"]):visible');
        await expect(primary).toHaveCount(1);
        await expect(primary).toHaveAccessibleName('Prepara il nuovo kit');
        await expect(primary).toHaveAttribute('type', 'submit');
        await expect(access.locator('form').getByRole('button', { name: 'Prepara il nuovo kit', exact: true })).toHaveClass(/\bmf-button-primary\b/u);
        await page.getByRole('button', { name: 'Cambio PIN', exact: true }).click();
        for (const id of ['current-pin', 'new-pin', 'confirm-pin']) await expect(page.locator(`#${id}`)).toHaveValue('');
        await expect(access.getByRole('status')).toHaveCount(0);
        await capture(page, zoom, 'accesso', page.locator('#current-pin'));
        await page.getByRole('button', { name: 'Passa dal PIN alla passphrase', exact: true }).click();
        await page.locator('#access-adopt-secret').fill('1234');
        await page.locator('#access-adopt-new').fill('Passphrase W19 inventata');
        await page.locator('#access-adopt-confirm').fill('Conferma diversa inventata');
        await expect(access.getByRole('status')).toContainText('Le passphrase non corrispondono.');
        await expect(access.getByRole('button', { name: 'Prepara il nuovo kit', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'Cambio PIN', exact: true }).click();
        await expect(primary).toHaveCount(1);
        await expect(primary).toHaveAccessibleName('Aggiorna PIN');
        await page.locator('#current-pin').fill('1234'); await page.locator('#new-pin').fill('5678'); await page.locator('#confirm-pin').fill('8765');
        await page.getByRole('button', { name: 'Aggiorna PIN', exact: true }).click();
        await expect(access.getByRole('status')).toHaveText('La conferma del nuovo PIN non corrisponde.');
        await page.getByRole('button', { name: 'Passa dal PIN alla passphrase', exact: true }).click();
        await expect(page.locator('#access-adopt-new')).toHaveValue('Passphrase W19 inventata');
        await page.getByRole('button', { name: 'Cambio PIN', exact: true }).focus(); await page.keyboard.press('Enter');
        await expect(page.getByRole('button', { name: 'Cambio PIN', exact: true })).toBeFocused();
        await expect(page.locator('#new-pin')).toHaveValue('5678');
        let pinPosts = 0, releasePin!: () => void;
        const pinGate = new Promise<void>(resolve => { releasePin = resolve; releaseGates.push(resolve); });
        await page.route('**/api/auth/change-pin', async route => {
            pinPosts++; await pinGate;
            await route.fulfill({ status: 403, json: { error: 'Diniego sintetico cambio PIN' } });
        });
        await page.locator('#confirm-pin').fill('5678'); await page.getByRole('button', { name: 'Aggiorna PIN', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Aggiornamento...', exact: true })).toBeDisabled();
        releasePin(); await expect(access.getByRole('status')).toContainText('Diniego sintetico cambio PIN');
        expect(pinPosts).toBe(1);
        await stateCapture(page, zoom, 'accesso-diniego', access.getByRole('status'));
        await page.unroute('**/api/auth/change-pin');
        await page.getByRole('button', { name: 'Rinnova accesso', exact: true }).click();
        await expect(page.getByLabel('MediFlow lock screen', { exact: true })).toBeVisible();
        await test.step('ordinary unlock after Access lock', () => unlockIfNeeded(page, '1234'));

        let releaseRead!: () => void;
        const readGate = new Promise<void>(resolve => { releaseRead = resolve; releaseGates.push(resolve); });
        let holdRead = true, failRead = false;
        await page.route('**/api/auth/profile', async route => {
            if (route.request().method() !== 'GET') return route.continue();
            if (holdRead) await readGate;
            return failRead ? route.fulfill({ status: 503, json: { error: 'Lettura sintetica indisponibile' } }) : route.continue();
        });
        await test.step('navigate to Profile and ordinary unlock', () => go('/settings/profilo'));
        const profile = page.getByTestId('settings-profile-section'), name = page.getByLabel('Nome medico', { exact: true });
        const save = page.getByRole('button', { name: 'Salva profilo', exact: true });
        await expect(profile.getByRole('status').filter({ hasText: 'Caricamento del profilo…' })).toBeVisible();
        await expect(name).toBeDisabled(); await stateCapture(page, zoom, 'profilo-caricamento', profile.getByRole('status'));
        holdRead = false; releaseRead(); await expect(name).toBeEnabled();
        await expect(profile.getByRole('status')).toHaveCount(0);
        await capture(page, zoom, 'profilo', name);
        const back = page.locator('a[href="/settings"]:visible').filter({ hasText: /Torna alle impostazioni|Panoramica/u });
        await back.click(); await expect(page).toHaveURL(new URL('/settings', baseURL!).href);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.getByRole('link', { name: 'Profilo', exact: true }).click(); await expect(name).toBeEnabled();
        const keepDraft = async () => {
            await back.focus(); await page.keyboard.press('Enter');
            const dialog = page.getByRole('dialog', { name: 'Lasciare la compilazione?', exact: true });
            await expect(dialog).toBeVisible();
            await dialog.getByRole('button', { name: 'Continua la compilazione', exact: true }).click();
            await expect(back).toBeFocused(); await expect(name).toHaveValue('Bozza W19 inventata non salvata');
        };
        await name.fill('Bozza W19 inventata non salvata');
        await page.getByRole('button', { name: 'Il tuo modo di lavorare', exact: true }).click();
        const activity = page.getByRole('radio', { name: 'Consultare e compilare cartelle', exact: true });
        await activity.check(); await expect(save).not.toHaveAttribute('data-settings-primary', 'true');
        await expect(profile.locator(':is(button,a)[class*="primaryAction"]:visible')).toHaveCount(1);
        await page.getByRole('button', { name: 'Il tuo modo di lavorare', exact: true }).click();
        await expect(save).toHaveAttribute('data-settings-primary', 'true'); await expect(name).toHaveValue('Bozza W19 inventata non salvata');
        await page.getByRole('button', { name: 'Il tuo modo di lavorare', exact: true }).click(); await expect(activity).toBeChecked();
        await page.getByRole('button', { name: 'Il tuo modo di lavorare', exact: true }).click();
        failRead = true; await page.getByRole('button', { name: 'Rileggi profilo mantenendo la bozza', exact: true }).click();
        await expect(profile.getByRole('status')).toContainText('Lettura non riuscita.'); await expect(save).toBeDisabled();
        await expect(name).toHaveValue('Bozza W19 inventata non salvata'); await stateCapture(page, zoom, 'profilo-lettura-negata', profile.getByRole('status'));
        await keepDraft();
        failRead = false; await page.getByRole('button', { name: 'Rileggi profilo mantenendo la bozza', exact: true }).click();
        await expect(save).toBeEnabled(); await keepDraft();
        await page.unroute('**/api/auth/profile');
        const sibling = await page.context().newPage();
        try {
            const siblingGoto = sibling.goto.bind(sibling);
            sibling.goto = (url, options) => siblingGoto(new URL(url, baseURL!).href, options);
            await protect(sibling, baseURL!);
            await bootstrapUnlockedSession(sibling, '1234'); await page.bringToFront();
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            await expect(profile.getByRole('status')).toContainText('La sessione è cambiata');
            await expect(save).toBeDisabled(); await keepDraft();
        } finally { await sibling.close(); }
        await page.getByRole('button', { name: 'Rileggi profilo mantenendo la bozza', exact: true }).click(); await expect(save).toBeEnabled();
        await save.click(); await expect(profile.getByRole('status')).toHaveText('Profilo aggiornato.');
        await back.click(); await expect(page).toHaveURL(new URL('/settings', baseURL!).href); await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.getByRole('link', { name: 'Profilo', exact: true }).click(); await expect(name).toHaveValue('Bozza W19 inventata non salvata');
        await name.fill('Bozza W19 da abbandonare'); await back.click();
        await page.getByRole('dialog').getByRole('button', { name: 'Esci senza salvare', exact: true }).click();
        await expect(page).toHaveURL(new URL('/settings', baseURL!).href);
        await page.getByRole('link', { name: 'Profilo', exact: true }).click(); await expect(name).toHaveValue('Bozza W19 inventata non salvata');

        expect(errors).toEqual([]);
    } finally { for (const release of releaseGates) release(); await page.unrouteAll({ behavior: 'ignoreErrors' }); await zoom.close(); }
});


test('passphrase account presentation consumes a declared auth-check mock without changing credentials', async ({ page, baseURL }) => {
    requireSynthetic(baseURL); await protect(page, baseURL!);
    await bootstrapUnlockedSession(page, '1234'); await page.goto('/settings/accesso'); await unlockIfNeeded(page, '1234');
    await page.bringToFront(); await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
    let passphrasePosts = 0, mockChecks = 0;
    await page.route('**/api/auth/passphrase', route => { passphrasePosts++; return route.abort(); });
    await page.route('**/api/auth/check', async route => {
        const response = await route.fetch(); mockChecks++;
        await route.fulfill({ response, json: { ...await response.json(),
            unlock: { credential: 'passphrase', kdfVersion: 3, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' } } });
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => mockChecks).toBe(1);
    const access = page.getByTestId('settings-access-section'), passphrase = page.getByTestId('settings-access-passphrase');
    await expect(passphrase).toBeVisible();
    await expect(access.getByRole('button', { name: 'Aggiorna PIN', exact: true })).toHaveCount(0);
    await page.getByLabel('Passphrase attuale', { exact: true }).fill('Passphrase corrente inventata');
    await page.getByRole('button', { name: 'Sblocco con passphrase', exact: true }).click();
    await page.getByRole('button', { name: 'Sblocco con passphrase', exact: true }).click();
    await expect(page.getByLabel('Passphrase attuale', { exact: true })).toHaveValue('Passphrase corrente inventata');
    const directory = process.env.SETTINGS_ACCOUNT_SCREENSHOTS;
    if (directory) {
        await mkdir(directory, { recursive: true });
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await passphrase.locator('p').first().evaluate(element => element.scrollIntoView({ block: 'center' }));
            await page.screenshot({ path: `${directory}/accesso-passphrase-render-mock-${width}.png`, fullPage: false, animations: 'disabled' });
        }
        await writeFile(`${directory}/passphrase-render-mock-receipt.json`, JSON.stringify({ mockChecks, passphrasePosts,
            scope: 'Rendering and mounted draft only; synthetic PIN archive unchanged, no passphrase credential or wrapping qualification' }));
    }
    expect(passphrasePosts).toBe(0);
});


test('appearance settings preserve selection and keyboard focus', async ({ baseURL }) => {
    test.setTimeout(120_000); requireSynthetic(baseURL);
    const zoom = await openBrowserZoomFixture(baseURL!), page = zoom.page;
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await protect(page, baseURL!);
    const go = async (path: string) => { await page.goto(new URL(path, baseURL!).href); await unlockIfNeeded(page, '1234'); };
    try {
        const originalGoto = page.goto.bind(page);
        page.goto = (url, options) => originalGoto(new URL(url, baseURL!).href, options);
        await bootstrapUnlockedSession(page, '1234');
        await go('/settings/aspetto');
        const appearance = page.getByTestId('settings-appearance-section');
        const dark = appearance.getByRole('button', { name: 'Tema Scuro', exact: true });
        await dark.focus(); await page.keyboard.press('Space'); await expect(dark).toBeFocused();
        await expect(page.locator('html')).toHaveClass(/dark/);
        await appearance.getByRole('button', { name: 'Tema Sistema', exact: true }).click();
        await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).toHaveClass(/light/);
        await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveClass(/dark/);
        const navigation = page.getByRole('radio', { name: 'Barra superiore', exact: true });
        await navigation.check(); await navigation.focus(); await page.keyboard.press('ArrowRight');
        await expect(page.getByRole('radio', { name: 'Barra laterale', exact: true })).toBeChecked();
        await expect(page.getByRole('radio', { name: 'Barra laterale', exact: true })).toBeFocused();
        await page.keyboard.press('ArrowLeft'); await expect(navigation).toBeChecked();
        const motion = page.getByRole('button', { name: /Riduci movimento/ });
        await motion.focus(); await page.keyboard.press('Space'); await expect(motion).toHaveAttribute('aria-pressed', 'true'); await expect(motion).toBeFocused();
        const privacy = page.getByTestId('settings-privacy-mode-pointer');
        await privacy.focus(); await page.keyboard.press('Space'); await expect(privacy).toHaveAttribute('aria-pressed', 'true'); await expect(privacy).toBeFocused();
        expect((await page.request.get(new URL('/api/patients', baseURL!).href)).status()).toBe(200);
        await page.reload(); await unlockIfNeeded(page, '1234');
        await expect(motion).toHaveAttribute('aria-pressed', 'true'); await expect(privacy).toHaveAttribute('aria-pressed', 'true');
        await motion.click(); await privacy.click(); await capture(page, zoom, 'aspetto', privacy);
        expect(errors).toEqual([]);
    } finally { await zoom.close(); }
});
