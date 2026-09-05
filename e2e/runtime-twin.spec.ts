/* @Codex WUL-676: exhaustive route presence, bounded representative actions. */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapUnlockedSession, unlockIfNeeded } from './utils';

const enabled = process.env.MEDIFLOW_TEST_RUNTIME_TWIN === '1';
test.skip(!enabled, 'Requires the marked synthetic runtime twin; never target a normal instance.');
const patient = 'twin-086-01';
const templates = fs.readdirSync(path.resolve('app'), { recursive: true })
    .filter((file): file is string => typeof file === 'string' && /(?:^|\/)page\.tsx$/.test(file) && !file.startsWith('mockups/'))
    .map(file => '/' + file.replace(/(?:^|\/)page\.tsx$/, ''))
    .sort();
const routes = templates.flatMap(template => template.includes('[scaleId]')
    ? ['tinetti-poma28-v1', 'adl', 'iadl', 'mmse', 'gds'].map(scale => template.replace('[id]', patient).replace('[scaleId]', scale))
    : [template.replace('[id]', patient)]);
let context: BrowserContext;
let page: Page;
const evidence: Array<{ route: string; controls: number }> = [];
const faults: string[] = [];

test.beforeAll(async ({ browser, baseURL }) => {
    if (!enabled) return;
    const url = new URL(baseURL!);
    expect(url.hostname).toBe('127.0.0.1');
    expect(Number(url.port)).toBeGreaterThanOrEqual(3200);
    expect(Number(url.port)).toBeLessThan(3400);
    context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } });
    page = await context.newPage();
    page.on('pageerror', error => faults.push(error.message));
    await bootstrapUnlockedSession(page, '086086');
    await expect(page.locator('html')).toHaveAttribute('data-runtime-twin', 'true');
    await expect(page.getByTestId('runtime-twin-toolbar')).toBeVisible();
});

test.afterAll(async () => {
    if (!enabled) return;
    fs.mkdirSync('tmp-086-twin', { recursive: true });
    if (evidence.length) fs.writeFileSync('tmp-086-twin/routes.json', JSON.stringify({ templates: templates.length, evidence, faults }, null, 2));
    await context?.close();
});

for (const route of routes) {
    test(`full web route ${route}`, async () => {
        const before = faults.length;
        const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
        expect(response?.status()).toBe(200);
        await expect(page.getByTestId('runtime-twin-toolbar')).toBeVisible();
        await expect(page.locator('main, [aria-label="MediFlow lock screen"]').first()).toBeVisible();
        await unlockIfNeeded(page, '086086');
        await expect(page.locator('main').first()).toBeVisible();
        await expect(page.locator('h1').first()).toBeVisible();
        if (route === `/patients/${patient}`) await expect(page).toHaveURL(new RegExp(`/patients/${patient}/modules`));
        if (route === '/settings/ai') await expect(page).toHaveURL(/\/settings\/ai\/fabric$/);
        // Let canonical URL updates and auth hydration finish before the next
        // hard navigation; otherwise an alias replace can abort the next visit.
        await page.waitForTimeout(350);
        await expect(page.getByText('This page could not be found.', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toHaveCount(0);
        const controls = await page.locator('main').first().locator('a, button, input, select, textarea').count();
        evidence.push({ route, controls });
        expect(faults.slice(before)).toEqual([]);
    });
}

test('all cockpit areas and patient contexts remain reachable', async () => {
    for (const area of ['turno', 'incarico', 'diario', 'repertori', 'governance', 'scheda', 'revisione', 'handoff']) {
        const response = await page.goto(`/?area=${area}&paziente=${patient}`);
        expect(response?.status()).toBe(200);
        await expect(page.locator('main, [data-testid="lume-frame"]').first()).toBeVisible();
        if (area === 'scheda') await expect(page).toHaveURL(/\/modules/);
        else await expect(page.getByTestId('lume-frame')).toBeVisible();
    }
});

test('design comparison preserves an unfinished form and real save persists', async () => {
    await page.goto('/settings/profilo');
    const name = page.locator('#doctor-name');
    await expect(name).not.toHaveValue('');
    const original = await name.inputValue();
    await name.fill('Medico Demo · verifica sintetica');
    await page.getByRole('button', { name: 'Originale', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-runtime-twin-design', 'original');
    await expect(name).toHaveValue('Medico Demo · verifica sintetica');
    await page.getByRole('button', { name: 'Proposta', exact: true }).click();
    await expect(name).toHaveValue('Medico Demo · verifica sintetica');
    const saved = page.waitForResponse(response => response.url().endsWith('/api/auth/profile') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Salva profilo', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByText('Profilo aggiornato', { exact: true })).toBeVisible();
    await page.reload();
    await expect(name).toHaveValue('Medico Demo · verifica sintetica');
    await name.fill(original);
    const restored = page.waitForResponse(response => response.url().endsWith('/api/auth/profile') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Salva profilo', exact: true }).click();
    expect((await restored).status()).toBe(200);
    await expect(page.getByText('Profilo aggiornato', { exact: true })).toBeVisible();
});

test('real diary save returns to the folder and survives reload', async () => {
    await page.goto(`/patients/${patient}/entries/new`);
    const text = `Verifica interattiva sintetica 0.8.6 (${Date.now()}). Nessun dato reale.`;
    await page.getByRole('textbox', { name: 'Resoconto clinico', exact: true }).fill(text);
    const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/entries' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Registra nel diario', exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const saved = await response.json() as { id: string };
    await expect(page).toHaveURL(new RegExp(`/patients/${patient}/modules`));
    const entries = await page.evaluate(async () => {
        const response = await fetch('/api/entries?patientId=twin-086-01');
        if (!response.ok) throw new Error(`Diary reread ${response.status}`);
        return response.json() as Promise<Array<{ id: string; version: number; content: string }>>;
    });
    // The normal UI writer encrypts content; the public API seed is not an
    // encryption proof. Verify this real write separately from route coverage.
    const written = entries.find(entry => entry.id === saved.id);
    expect(written?.content.startsWith('ENC:')).toBe(true);
    await page.goto(`/patients/${patient}/modules#diario`);
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    // Remove only this test's generated entry through the normal versioned API.
    const deleted = await page.evaluate(async ({ id, version }) => {
        const response = await fetch(`/api/entries/${id}`, { method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }),
        });
        return response.status;
    }, { id: saved.id, version: written!.version });
    expect(deleted).toBe(200);
});

test('settings search, mobile navigation, focus and both palettes', async () => {
    test.setTimeout(90_000);
    for (const theme of ['light', 'dark']) {
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
            await page.goto('/settings/aspetto');
            await page.getByRole('button', { name: theme === 'light' ? 'Tema Chiaro' : 'Tema Scuro', exact: true }).click();
            await expect(page.locator('html')).toHaveClass(new RegExp(theme));
            if (width === 390) {
                const toggle = page.getByTestId('settings-nav-mobile-toggle');
                await toggle.click();
                await expect(toggle).toHaveAttribute('aria-expanded', 'true');
                await page.getByTestId('settings-nav-mobile-profilo').click();
                await expect(page).toHaveURL(/\/settings\/profilo$/);
                await expect(toggle).toBeFocused();
                await expect(toggle).toHaveAttribute('aria-expanded', 'false');
            } else {
                await page.getByTestId('settings-nav-profilo').click();
                await expect(page.getByTestId('settings-nav-profilo')).toHaveAttribute('aria-current', 'page');
            }
            await expect(page.locator('#doctor-name')).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
            await page.screenshot({ path: `tmp-086-twin/settings-${theme}-${width}.png` });
            await page.goto(`/patients/${patient}/modules`);
            await expect(page.getByTestId('lume-scheda-surface')).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
            await page.screenshot({ path: `tmp-086-twin/patient-${theme}-${width}.png` });
        }
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/settings/profilo');
    await expect(page.locator('#doctor-name')).not.toHaveValue('');
    await page.getByRole('button', { name: /Cerca impostazione/ }).click();
    await expect(page.getByTestId('settings-search-input')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+k');
    await page.getByTestId('settings-search-input').fill('accessibilità');
    await page.getByTestId('settings-search-result-aspetto').click();
    await expect(page).toHaveURL(/\/settings\/aspetto$/);
});

test('first setup exposes all four real steps without resetting the populated twin', async ({ browser }) => {
    test.skip(!process.env.MEDIFLOW_TWIN_ONBOARDING_URL, 'Separate first-setup server not requested');
    const setup = await browser.newPage({ baseURL: process.env.MEDIFLOW_TWIN_ONBOARDING_URL });
    try {
        await setup.goto('/');
        await expect(setup.locator('html')).toHaveAttribute('data-runtime-twin', 'true');
        await expect(setup.getByRole('heading', { name: 'Chi sei?' })).toBeVisible();
        await setup.getByPlaceholder('es. Dott. Nome Medico').fill('Medico Demo sintetico');
        await setup.getByPlaceholder('es. Studio Medico Centrale').fill('Ambulatorio sintetico');
        await setup.getByRole('button', { name: 'Avanti', exact: true }).click();
        await expect(setup.getByRole('heading', { name: 'Ruolo', exact: true })).toBeVisible();
        await setup.getByRole('button', { name: 'Avanti', exact: true }).click();
        await expect(setup.getByRole('heading', { name: 'Credenziali di Accesso' })).toBeVisible();
        await setup.getByPlaceholder('es. operatore.demo').fill('demo086');
        await setup.getByPlaceholder('Password sicura').fill('prototipo-sintetico-086');
        await setup.getByRole('button', { name: 'Avanti', exact: true }).click();
        await expect(setup.getByRole('heading', { name: 'Sicurezza', exact: true })).toBeVisible();
        await expect(setup.getByRole('button', { name: 'Concludi Setup' })).toBeVisible();
        await setup.reload();
        await expect(setup.getByRole('heading', { name: 'Chi sei?' })).toBeVisible();
        await setup.screenshot({ path: 'tmp-086-twin/onboarding.png' });
    } finally { await setup.close(); }
});
