/* First-use UI acceptance: the existing isolated fixture owns an initially
 * empty synthetic DB and a genuine standalone child. No route interception,
 * account/session injection, readiness replacement or database seeding here.
 * Theme class changes below are presentation-only, not theme-provider coverage.
 * Reflow viewports are NOT claimed as native browser zoom.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures/isolated-runtime';
import { assertKeyboardFocusProgresses, assertNoHorizontalOverflow, unlockIfNeeded } from './utils';
import { parseWorkProfileState } from '../lib/work-profile';

const PIN = 'FirstUse086'; // Synthetic; exercise the existing text PIN, never a new PIN policy.
const endpoint = '/api/onboarding/work-profile';
const panelSelector = '[data-testid="work-profile-onboarding"]';
const setupSelector = '[data-testid="onboarding-setup"]';

async function readProfile(page: Page) {
    const response = await page.request.get(endpoint);
    expect(response.status()).toBe(200);
    return parseWorkProfileState(await response.json());
}

function observe(page: Page, baseURL: string) {
    const origin = new URL(baseURL).origin;
    const remote: string[] = [];
    const pageErrors: string[] = [];
    const consoleErrors: { text: string; url: string }[] = [];
    const apiCalls: { method: string; path: string }[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url });
    });
    page.on('request', request => {
        const url = new URL(request.url());
        if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.origin !== origin) remote.push(url.origin);
        if (url.pathname.startsWith('/api/')) apiCalls.push({ method: request.method(), path: url.pathname });
    });
    return async (info: TestInfo) => {
        await info.attach('first-use-diagnostics.json', {
            body: JSON.stringify({ remote, pageErrors, consoleErrors, apiCalls }, null, 2),
            contentType: 'application/json',
        });
        expect(remote).toEqual([]);
        expect(pageErrors).toEqual([]);
        // Preserve the same precise startup diagnostic allowance as the existing spec.
        expect(consoleErrors.filter(({ text, url }) => !(url.endsWith('/api/auth/lock') && text.includes('409 (Conflict)')))).toEqual([]);
        expect(apiCalls.filter(call => call.path === '/api/proxy/ollama/chat')).toEqual([]);
        await expect(page.locator('nextjs-error-overlay')).toHaveCount(0);
    };
}

async function present(page: Page, width: number, theme: 'light' | 'dark', height = 960) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    // This uses the class contract present in globals.css, not an invented theme API.
    await page.evaluate(mode => {
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(mode);
    }, theme);
    await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`, 'u'));
}

async function focusVisible(page: Page, control: Locator) {
    // Traverse the real tab order, including a possible document-boundary stop.
    // Never focus the target programmatically: that would bypass keyboard reachability.
    const tabLimit = await page.locator('a[href], button, input, select, textarea, summary, [tabindex]').count() + 1;
    for (let step = 0; step < tabLimit; step += 1) {
        await page.keyboard.press('Tab');
        if (await control.evaluate(element => document.activeElement === element)) break;
    }
    await expect(control).toBeFocused();
    // Focus ownership can precede its painted style. Re-read each predicate within
    // the project's existing expect timeout; do not add sleeps or widen any limit.
    await expect.poll(() => control.evaluate(element => element.matches(':focus-visible'))).toBe(true);
    await expect.poll(() => control.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth)))
        .toBeGreaterThanOrEqual(2);
    await expect.poll(() => control.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
}

async function geometry(page: Page, selector: string) {
    await assertNoHorizontalOverflow(page, [
        { label: 'document', selector: 'document' }, { label: 'first-use surface', selector },
    ]);
    const surface = page.locator(selector);
    const controls = surface.locator('button, a, summary, input:not([type="radio"]), label:has(input[type="radio"])');
    for (const control of await controls.all()) {
        if (!(await control.isVisible())) continue; // Native closed disclosure content is not a target.
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
        expect(await control.evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe('12px');
    }
    // No entry animation even while the reduced-motion preference is active.
    const moving = await surface.evaluate(element => [element, ...element.querySelectorAll('*')]
        .filter(node => getComputedStyle(node).animationName !== 'none').length);
    expect(moving).toBe(0);
}

async function capture(page: Page, info: TestInfo, name: string, selector: string) {
    await geometry(page, selector);
    await page.locator(selector).scrollIntoViewIfNeeded();
    const body = await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
    await info.attach(name, { body, contentType: 'image/png' });
}

async function setup(page: Page, info?: TestInfo) {
    const root = page.getByTestId('onboarding-setup');
    await expect(page).toHaveTitle(/MediFlow/);
    await expect(root.getByRole('heading', { name: 'Chi sei?', exact: true })).toBeVisible();
    await expect(root.getByLabel('Avanzamento setup', { exact: true })).toHaveText('Passo 1 di 2');
    const next = root.getByRole('button', { name: 'Avanti', exact: true });
    await expect(next).toBeDisabled();
    const name = root.getByLabel('Nome e Cognome', { exact: true });
    const ambulatory = root.getByLabel('Nome Ambulatorio', { exact: true });
    await name.fill('Dr. Primo Avvio Sintetico');
    await expect(next).toBeDisabled();
    await name.focus();
    await page.keyboard.press('Tab');
    await expect(ambulatory).toBeFocused();
    await ambulatory.fill('Ambulatorio Primo Avvio Sintetico');
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();
    await expect(next).toBeEnabled();
    if (info) await capture(page, info, 'identity', setupSelector);
    await next.press('Enter');
    await expect(root.getByRole('heading', { name: 'Sicurezza', exact: true })).toBeVisible();
    await expect(root.getByLabel('Avanzamento setup', { exact: true })).toHaveText('Passo 2 di 2');
    await expect(root.locator('#setup-pin-help')).toContainText('almeno 4 caratteri');
    const pin = root.getByLabel('PIN di accesso e cifratura', { exact: true });
    const confirmation = root.getByLabel('Conferma PIN', { exact: true });
    const submit = root.getByRole('button', { name: 'Concludi Setup', exact: true });
    await expect(pin).toHaveAttribute('type', 'password');
    await expect(pin).toHaveAttribute('inputmode', 'text');
    await expect(confirmation).toHaveAttribute('type', 'password');
    await pin.fill('abc');
    await confirmation.fill('abc');
    await expect(submit).toBeDisabled();
    await pin.fill(PIN);
    await confirmation.fill('Mismatch086');
    await expect(root.getByText('I PIN non corrispondono.', { exact: true })).toBeVisible();
    await expect(confirmation).toHaveAttribute('aria-invalid', 'true');
    await expect(submit).toBeDisabled();
    await confirmation.fill(PIN);
    await expect(confirmation).toHaveAttribute('aria-invalid', 'false');
    await expect(submit).toBeEnabled();
    if (info) await capture(page, info, 'pin', setupSelector);
    const response = page.waitForResponse(item => item.request().method() === 'POST'
        && new URL(item.url()).pathname === '/api/auth/setup');
    await submit.click();
    expect((await response).status()).toBe(200);
    const panel = page.getByTestId('work-profile-onboarding');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-busy', 'false');
    expect((await readProfile(page)).active).toBeNull();
}

async function guidedPreview(page: Page) {
    const panel = page.getByTestId('work-profile-onboarding');
    await expect(panel.getByRole('button', { name: 'Salva e continua', exact: true })).toBeDisabled();
    await panel.getByRole('radio', { name: 'Consultare e compilare cartelle', exact: true }).check();
    await panel.getByRole('button', { name: 'Salva e continua', exact: true }).click();
    await expect(panel.getByRole('group', { name: 'Come preferisci lavorare?', exact: true })).toBeVisible();
    await panel.getByRole('radio', { name: 'Usare direttamente le schermate', exact: true }).check();
    await panel.getByRole('button', { name: 'Salva e continua', exact: true }).click();
    await expect(panel.getByRole('group', { name: 'Su quale sistema lavori?', exact: true })).toBeVisible();
    await panel.getByRole('radio', { name: 'Windows', exact: true }).check();
    await panel.getByRole('button', { name: 'Mostra anteprima', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'Anteprima del profilo', exact: true })).toBeVisible();
    await expect(panel).toHaveAttribute('aria-busy', 'false');
    const state = await readProfile(page);
    expect(state.active).toBeNull();
    expect(state.draft).toMatchObject({ step: 3, profile: 'interactive', source: 'guided',
        answers: { activity: 'records', interaction: 'screens', platform: 'windows' } });
}

async function profileSettings(page: Page) {
    await page.goto('/settings/profilo');
    const panel = page.getByTestId('work-profile-onboarding');
    const lock = page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true });
    await expect(panel.or(lock).first()).toBeVisible();
    await unlockIfNeeded(page, PIN);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-busy', 'false');
}

for (const width of [390, 1440]) for (const theme of ['light', 'dark'] as const) {
    test(`first use: guided entry without AI, ${width}px ${theme}, reduced motion`, async ({ page, baseURL }, info) => {
        const check = observe(page, baseURL!);
        await page.goto('/');
        await present(page, width, theme, width === 390 ? 844 : 960);
        await setup(page, info);
        const panel = page.getByTestId('work-profile-onboarding');
        const manual = panel.getByRole('link', { name: 'Apri la cartella manualmente', exact: true });
        await expect(manual).toHaveAttribute('href', '/?area=turno');
        await expect(manual).toBeVisible();
        await expect(panel.getByLabel('Avanzamento guida', { exact: true })).toHaveCount(1);
        await expect(panel.getByRole('radio', { checked: true })).toHaveCount(0);
        await capture(page, info, 'question', panelSelector);
        await guidedPreview(page);
        await expect(panel.getByText('Consigliato:', { exact: false })).toContainText('Interactive');
        await expect(panel.getByRole('list', { name: 'Azioni da confermare', exact: true })).toContainText('Aprire Lista pazienti');
        await expect(panel.getByText('Il profilo non installa app e non attiva agenti.', { exact: true })).toBeVisible();
        await expect(panel.getByRole('radio', { name: 'Interactive', exact: true })).toBeChecked();
        await expect(panel.getByRole('radio', { name: 'Interactive', exact: true })).toHaveAccessibleDescription('Usa direttamente le schermate della cartella.');
        await expect(panel.getByRole('radio', { name: 'Agent', exact: true })).toHaveAccessibleDescription(/da collegare separatamente/u);
        await expect(panel.getByRole('radio', { name: 'Entrambi · Interactive e Agent', exact: true })).toHaveAccessibleDescription(/quando configurato/u);
        const details = panel.locator('details');
        await expect(details).not.toHaveAttribute('open', '');
        await expect(panel.getByText(/app desktop completa non è attestata/u)).toBeHidden();
        await capture(page, info, 'preview-closed', panelSelector);
        const beforeDetails = await readProfile(page);
        const summary = details.locator('summary');
        await focusVisible(page, summary);
        await summary.press('Enter');
        await expect(details).toHaveAttribute('open', '');
        await expect(panel.getByText(/non collega né verifica un agente/u)).toBeVisible();
        await expect(panel.getByText(/app desktop completa non è attestata/u)).toBeVisible();
        expect(await readProfile(page)).toEqual(beforeDetails);
        await capture(page, info, 'preview-details', panelSelector);
        await summary.press('Space');
        await expect(details).not.toHaveAttribute('open', '');
        const confirm = panel.getByRole('button', { name: 'Conferma profilo di lavoro', exact: true });
        await focusVisible(page, confirm);
        await confirm.press('Enter');
        await expect(panel).toHaveCount(0);
        await expect(page.getByRole('heading', { name: /Pazienti in carico/u, level: 1 })).toBeVisible();
        await expect(page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true })).toBeVisible();
        expect((await readProfile(page)).active?.profile).toBe('interactive');
        await check(info);
    });
}

test('first use: manual entry creates the first synthetic patient without saving a work profile', async ({ page, baseURL }, info) => {
    const check = observe(page, baseURL!);
    await page.goto('/');
    await setup(page);
    const panel = page.getByTestId('work-profile-onboarding');
    const before = await readProfile(page);
    await panel.getByRole('link', { name: 'Apri la cartella manualmente', exact: true }).click();
    await expect(page).toHaveURL(/[?&]area=turno/u);
    expect(await readProfile(page)).toEqual(before);
    const initial = await page.request.get('/api/patients');
    expect(initial.status()).toBe(200);
    expect(await initial.json()).toEqual([]);
    // Ordinary form/locators from the frozen patient-bulk-import spec, not a mocked patient API.
    await page.getByRole('link', { name: /^Nuova scheda(?: da documento)?$/u }).click();
    await expect(page).toHaveURL(/\/patients\/new$/u);
    await page.locator('input[name="firstName"]').fill('Prima');
    await page.locator('input[name="lastName"]').fill('Sintetica');
    await page.locator('input[name="taxCode"]').fill('SYNTHETIC0000086');
    const response = page.waitForResponse(item => item.request().method() === 'POST'
        && new URL(item.url()).pathname === '/api/patients');
    await page.getByRole('button', { name: 'Crea scheda', exact: true }).click();
    expect((await response).status()).toBe(201);
    await expect(page).toHaveURL(/\/$/u);
    const persisted = await page.request.get('/api/patients');
    expect(persisted.status()).toBe(200);
    const rows = await persisted.json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ firstName: 'Prima', lastName: 'Sintetica', taxCode: 'SYNTHETIC0000086' });
    expect(await readProfile(page)).toEqual(before);
    await check(info);
});

test('first use: keyboard manual selection, explicit rollback preview and cancellation', async ({ page, baseURL }, info) => {
    const check = observe(page, baseURL!);
    await page.goto('/');
    await setup(page);
    const panel = page.getByTestId('work-profile-onboarding');
    await panel.getByRole('button', { name: 'Scegli manualmente', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'Anteprima del profilo', exact: true })).toBeVisible();
    await expect(panel).toHaveAttribute('aria-busy', 'false');
    await panel.getByRole('button', { name: 'Conferma profilo di lavoro', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await profileSettings(page);
    await panel.getByRole('button', { name: 'Cambia profilo di lavoro', exact: true }).click();
    await expect(panel.getByRole('radio', { name: 'Interactive', exact: true })).toBeChecked();
    const interactive = panel.getByRole('radio', { name: 'Interactive', exact: true });
    await focusVisible(page, interactive);
    await interactive.press('ArrowDown');
    await expect(panel.getByRole('radio', { name: 'Agent', exact: true })).toBeChecked();
    await expect.poll(async () => (await readProfile(page)).draft?.profile).toBe('agent');
    await expect(panel).toHaveAttribute('aria-busy', 'false');
    await panel.getByRole('button', { name: 'Conferma profilo di lavoro', exact: true }).click();
    await expect(panel.getByText(/Profilo salvato:/u)).toContainText('Agent');
    const before = await readProfile(page);
    await panel.getByRole('button', { name: 'Ripristina la scelta precedente', exact: true }).click();
    await expect(panel.getByText(/Ripristino previsto:/u)).toContainText('Interactive');
    await expect(panel.getByText(/La bozza corrente sarà scartata/u)).toBeVisible();
    expect(await readProfile(page)).toEqual(before);
    const cancel = panel.getByRole('button', { name: 'Annulla ripristino', exact: true });
    await assertKeyboardFocusProgresses(page, cancel, 'rollback cancellation');
    await cancel.press('Enter');
    expect(await readProfile(page)).toEqual(before);
    await expect(panel.getByRole('button', { name: 'Conferma ripristino del profilo', exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Ripristina la scelta precedente', exact: true }).click();
    await panel.getByRole('button', { name: 'Conferma ripristino del profilo', exact: true }).press('Enter');
    await expect(panel.getByText(/Profilo salvato:/u)).toContainText('Interactive');
    const restored = await readProfile(page);
    expect(restored.active?.profile).toBe('interactive');
    expect(restored.draft).toBeNull();
    expect(restored.canRollback).toBe(false);
    await check(info);
});

for (const width of [320, 768]) {
    test(`first use: short viewport ${width}px reflow proxy, not native browser zoom`, async ({ page, baseURL }, info) => {
        const check = observe(page, baseURL!);
        await page.goto('/');
        await present(page, width, 'dark', 480);
        await setup(page, info);
        const panel = page.getByTestId('work-profile-onboarding');
        await panel.getByRole('button', { name: 'Scegli manualmente', exact: true }).click();
        await expect(panel.getByRole('heading', { name: 'Anteprima del profilo', exact: true })).toBeVisible();
        await expect(panel).toHaveAttribute('aria-busy', 'false');
        await capture(page, info, 'manual-reflow', panelSelector);
        const manual = panel.getByRole('link', { name: 'Apri la cartella manualmente', exact: true });
        await focusVisible(page, manual);
        await assertKeyboardFocusProgresses(page, manual, 'always available manual entry');
        await manual.press('Enter');
        await expect(page).toHaveURL(/[?&]area=turno/u);
        expect((await readProfile(page)).active).toBeNull();
        await check(info);
    });
}
