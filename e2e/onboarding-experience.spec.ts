/* First-use UI acceptance: the existing isolated fixture owns an initially
 * empty synthetic DB and a genuine standalone child. No route interception,
 * account/session injection, readiness replacement or database seeding here.
 * Theme class changes below are presentation-only, not theme-provider coverage.
 * Reflow viewports are NOT claimed as native browser zoom.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures/isolated-runtime';
import { assertKeyboardFocusProgresses, assertNoHorizontalOverflow } from './utils';
import { parseWorkProfileState } from '../lib/work-profile';

const PIN = 'FirstUse086'; // Synthetic; exercise the existing text PIN, never a new PIN policy.
const PASSPHRASE = 'Primo avvio sintetico sicuro';
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
        expect(await control.evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe('10px');
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

async function unlockPassphrase(page: Page, passphrase = PASSPHRASE) {
    const lock = page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true });
    await expect(lock.or(page.getByTestId('work-profile-onboarding')).or(page.getByTestId('settings-access-section')).first()).toBeVisible();
    if (!await lock.isVisible()) return;
    const renew = page.getByRole('button', { name: 'Rinnova accesso', exact: true });
    if (await renew.isVisible()) await renew.click();
    const field = page.getByLabel('Passphrase', { exact: true });
    await expect(field).toBeEnabled(); await field.fill(passphrase);
    await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
    await expect(lock).toHaveCount(0);
    expect(await page.evaluate(() => [sessionStorage.getItem('mediflow_session_key'), sessionStorage.getItem('mediflow_user')])).toEqual([null, null]);
}

async function conserveKit(page: Page) {
    const panel = page.getByTestId('recovery-kit');
    const activate = panel.getByRole('button', { name: 'Attiva la nuova passphrase', exact: true });
    await expect(activate).toBeDisabled();
    const key = await panel.getByLabel('Chiave di recupero', { exact: true }).innerText();
    const download = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Scarica kit di recupero', exact: true }).click();
    const artifact = await download;
    const { readFile } = await import('node:fs/promises');
    const content = await readFile((await artifact.path())!, 'utf8');
    const kit = JSON.parse(content);
    expect(Object.keys(kit).sort()).toEqual(['salt', 'schemaVersion', 'username', 'wrappedMasterKey']);
    expect(kit.schemaVersion).toBe('mediflow.recovery-kit.v1');
    expect(content).not.toContain(key); expect(content).not.toContain(PASSPHRASE);
    await expect(activate).toBeDisabled();
    await panel.getByRole('checkbox').check(); await expect(activate).toBeEnabled();
    return { kit, key, content, activate };
}

async function setup(page: Page, info?: TestInfo) {
    const setupBodies: string[] = [];
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/setup') setupBodies.push(request.postData() ?? ''); });
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
    await expect(root.locator('#setup-pin-help')).toContainText('da 4 a 64 caratteri');
    const pin = root.getByLabel('PIN di conferma', { exact: true });
    const confirmation = root.getByLabel('Conferma PIN', { exact: true });
    const submit = root.getByRole('button', { name: 'Concludi Setup', exact: true });
    await expect(pin).toHaveAttribute('type', 'password');
    await expect(pin).toHaveAttribute('inputmode', 'text');
    await expect(confirmation).toHaveAttribute('type', 'password');
    await root.getByLabel('Passphrase di accesso', { exact: true }).fill(PASSPHRASE);
    await root.getByLabel('Conferma passphrase', { exact: true }).fill(PASSPHRASE);
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
    const passphrase = root.getByLabel('Passphrase di accesso', { exact: true });
    const passphraseConfirmation = root.getByLabel('Conferma passphrase', { exact: true });
    for (const outside of ['a'.repeat(14), 'a'.repeat(129)]) {
        await passphrase.fill(outside); await passphraseConfirmation.fill(outside); await expect(submit).toBeDisabled();
    }
    await passphrase.fill(PASSPHRASE.replace('P', 'Ｐ')); await passphraseConfirmation.fill(PASSPHRASE);
    await expect(submit).toBeEnabled();
    if (info) await capture(page, info, 'pin', setupSelector);
    const response = page.waitForResponse(item => item.request().method() === 'POST'
        && new URL(item.url()).pathname === '/api/auth/setup');
    await submit.click();
    const { activate, key } = await conserveKit(page);
    expect(setupBodies).toEqual([]);
    await activate.click();
    expect((await response).status()).toBe(200);
    expect(setupBodies).toHaveLength(1);
    expect(JSON.parse(setupBodies[0])).toMatchObject({ password: PIN, encryptedMasterKey: expect.stringMatching(/^v3:/u) });
    for (const secret of [PASSPHRASE, key]) expect(setupBodies[0]).not.toContain(secret);
    await unlockPassphrase(page);
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
    await unlockPassphrase(page);
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
        await expect(page.getByRole('heading', { name: /^Pazienti$/u, level: 1 })).toBeVisible();
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
    await expect(page).toHaveURL(/\?area=incarico$/u);
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: 'Cerca nella lista pazienti', exact: true })).toBeVisible();
    const persisted = await page.request.get('/api/patients');
    expect(persisted.status()).toBe(200);
    const rows = await persisted.json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ firstName: 'Prima', lastName: 'Sintetica', taxCode: 'SYNTHETIC0000086' });
    expect(await readProfile(page)).toEqual(before);
    // The same synthetic record remains readable after changing and recovering the access wrapping.
    const nextPassphrase = 'Cambio sintetico sicuro nuovo';
    const recoveredPassphrase = 'Recupero sintetico sicuro nuovo';
    const mutations: string[] = [];
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/auth/')) mutations.push(request.postData() ?? '');
    });
    await page.goto('/settings/accesso'); await unlockPassphrase(page);
    await page.getByLabel('Passphrase attuale', { exact: true }).fill(PASSPHRASE);
    await page.getByLabel('Nuova passphrase', { exact: true }).fill(nextPassphrase);
    await page.getByLabel('Conferma nuova passphrase', { exact: true }).fill(nextPassphrase);
    await page.getByRole('button', { name: 'Prepara il nuovo kit', exact: true }).click();
    const saved = await conserveKit(page);
    const change = page.waitForResponse(item => new URL(item.url()).pathname === '/api/auth/passphrase/change');
    await saved.activate.click(); expect((await change).status()).toBe(200);
    await unlockPassphrase(page, nextPassphrase);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
    const renew = page.getByRole('button', { name: 'Rinnova accesso', exact: true });
    if (await renew.isVisible()) await renew.click();
    await page.getByRole('button', { name: 'Recupera con kit e chiave', exact: true }).click();
    await page.getByLabel('Kit di recupero', { exact: true }).setInputFiles({ name: 'synthetic-kit.json', mimeType: 'application/json', buffer: Buffer.from(saved.content) });
    await page.getByLabel('Chiave di recupero', { exact: true }).fill(saved.key);
    await page.getByLabel('Nuova passphrase', { exact: true }).fill(recoveredPassphrase);
    await page.getByLabel('Conferma nuova passphrase', { exact: true }).fill(recoveredPassphrase);
    await page.getByRole('button', { name: 'Prepara il nuovo kit', exact: true }).click();
    const recovered = await conserveKit(page);
    const recovery = page.waitForResponse(item => new URL(item.url()).pathname === '/api/auth/passphrase/recover');
    await recovered.activate.click(); expect((await recovery).status()).toBe(200);
    await unlockPassphrase(page, recoveredPassphrase);
    const preserved = await page.request.get('/api/patients');
    expect(preserved.status()).toBe(200); expect(await preserved.json()).toEqual(rows);
    for (const secret of [PASSPHRASE, nextPassphrase, recoveredPassphrase, saved.key, recovered.key]) expect(mutations.join('')).not.toContain(secret);
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
