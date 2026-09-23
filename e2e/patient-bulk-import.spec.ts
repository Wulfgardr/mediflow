/* @Codex: real isolated runtime, real setup/key wrapping/client encryption/API.
 * Every name, CF, address, telephone and PIN below is a SYNTHETIC fixture.
 * No route interception, auth substitution, DB manipulation, skipped tests or custom timeouts.
 */
import type { Page, Request } from '@playwright/test';
import { test, expect } from './fixtures/isolated-runtime';

const PIN = 'bulk086086';
const header = 'nome;cognome;codice_fiscale;data_nascita;indirizzo;telefono';
const existingCode = 'SYNTHETIC0000009';
const firstCode = 'SYNTHETIC0000001';
const secondCode = 'SYNTHETIC0000002';
const body = [header,
    `Ada;Sintetica;${firstCode};2000-02-29;"Via Sintetica; interno 1";+390000001`,
    `Elena;Dimostrativa;${secondCode};;;`,
    'X;Non Valida;INVALIDO;2025-02-29;;',
    `Duplicata;Da Non Salvare;${existingCode};1999-01-01;Non sostituire;+390009999`,
].join('\r\n');
const file = (text: string) => ({ name: 'pazienti-SOLO-SINTETICI.csv', mimeType: 'text/csv', buffer: Buffer.from(`\uFEFF${text}`, 'utf8') });
const isPatientCreate = (request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/patients';

type WirePatient = { id: string; firstName: string; lastName: string; taxCode: string; birthDate?: string | null; address?: string | null; phone?: string | null; ambulatoryId?: string | null };
async function list(page: Page): Promise<WirePatient[]> {
    const response = await page.request.get('/api/patients', { headers: { 'Cache-Control': 'no-store' } });
    expect(response.status()).toBe(200);
    const rows: unknown = await response.json();
    expect(Array.isArray(rows)).toBe(true);
    return rows as WirePatient[];
}
async function unlocked(page: Page): Promise<void> {
    const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
    const manual = page.getByRole('link', { name: 'Apri la cartella manualmente', exact: true });
    await expect(navigation.or(manual).first()).toBeVisible();
    if (await manual.isVisible()) await manual.click();
    await expect(navigation).toBeVisible();
}
async function setup(page: Page): Promise<void> {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Chi sei?', exact: true })).toBeVisible();
    await page.getByLabel('Nome e Cognome', { exact: true }).fill('Dr. Importazione Sintetica');
    await page.getByLabel('Nome Ambulatorio', { exact: true }).fill('Ambulatorio CSV Sintetico');
    await page.getByRole('button', { name: 'Avanti', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sicurezza', exact: true })).toBeVisible();
    await page.locator('#setup-pin').fill(PIN);
    await page.locator('#setup-confirm-pin').fill(PIN);
    const response = page.waitForResponse(item => item.request().method() === 'POST' && new URL(item.url()).pathname === '/api/auth/setup');
    await page.getByRole('button', { name: 'Concludi Setup', exact: true }).click();
    expect((await response).status()).toBe(200);
    await unlocked(page);
    expect(await list(page)).toEqual([]);
}
async function unlockAfterReload(page: Page): Promise<void> {
    // A full reload may lose the in-memory key. Use the real existing form, never inject a key.
    const input = page.getByLabel('PIN operatore', { exact: true });
    const panel = page.getByTestId('patient-bulk-import');
    await expect(panel.or(input).first()).toBeVisible();
    if (await input.isVisible()) {
        await input.fill(PIN);
        const response = page.waitForResponse(item => item.request().method() === 'POST' && new URL(item.url()).pathname === '/api/auth/login');
        await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
        expect((await response).status()).toBe(200);
    }
    await expect(panel).toBeVisible();
}
// @Codex: first access can open Agenda; use the visible patient-area navigation.
async function openNewPatient(page: Page): Promise<void> {
    await page.getByRole('navigation', { name: 'Navigazione principale', exact: true })
        .getByRole('link', { name: 'Pazienti', exact: true }).click();
    await expect(page).toHaveURL(/\/\?area=incarico$/u);
    await page.getByRole('link', { name: 'Nuova scheda', exact: true }).click();
    await expect(page).toHaveURL(/\/patients\/new$/u);
}
async function createExistingFromUi(page: Page): Promise<WirePatient> {
    await openNewPatient(page);
    await page.locator('input[name="firstName"]').fill('Preesistente');
    await page.locator('input[name="lastName"]').fill('Sintetico');
    await page.locator('input[name="taxCode"]').fill(existingCode);
    await page.locator('input[name="birthDate"]').fill('1980-01-02');
    await page.locator('input[name="address"]').fill('Via Preesistente Sintetica');
    await page.locator('input[name="phone"]').fill('+390000009');
    const saved = page.waitForResponse(item => isPatientCreate(item.request()));
    await page.getByRole('button', { name: 'Crea scheda', exact: true }).click();
    expect((await saved).status()).toBe(201);
    // @Codex WUL-732: la creazione torna esplicitamente alla lista pazienti.
    await expect(page).toHaveURL(/\/\?area=incarico$/u);
    const rows = await list(page); expect(rows).toHaveLength(1);
    return rows[0];
}
async function enterImportViaNewPatient(page: Page): Promise<void> {
    await openNewPatient(page);
    await page.getByRole('link', { name: 'Importa elenco CSV', exact: true }).click();
    await expect(page).toHaveURL(/\/patients\/import$/u);
    await expect(page.getByRole('heading', { name: 'Importa elenco', exact: true })).toBeVisible();
    await expect(page.getByTestId('patient-bulk-file')).toBeEnabled();
}
async function present(page: Page, width: number, theme: 'light' | 'dark'): Promise<void> {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme });
    // Presentation-only CSS fixture using the actual :root.dark/:root.light contract in globals.css.
    // This does NOT claim coverage of the missing theme-picker/provider implementation.
    await page.evaluate(mode => {
        document.documentElement.classList.remove('dark', 'light');
        document.documentElement.classList.add(mode);
    }, theme);
    await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`, 'u'));
}

for (const width of [390, 1440]) for (const theme of ['light', 'dark'] as const) {
    test(`CSV reviewed creation and reload, ${width}px ${theme}, real synthetic runtime`, async ({ page, baseURL }, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
        await setup(page);
        const before = await createExistingFromUi(page);
        const creates: WirePatient[] = [];
        const createPreconditions: { mode: string | undefined; nonce: string | undefined; target: string | undefined }[] = [];
        const disallowed: string[] = [];
        const external: string[] = [];
        const origin = new URL(baseURL!).origin;
        page.on('request', request => {
            const url = new URL(request.url());
            if (/^https?:$/u.test(url.protocol) && url.origin !== origin) external.push(url.origin);
            if (isPatientCreate(request)) {
                creates.push(request.postDataJSON() as WirePatient);
                const headers = request.headers();
                createPreconditions.push({ mode: headers['x-mediflow-patient-create-mode'],
                    nonce: headers['x-mediflow-patient-create-context'], target: headers['x-mediflow-patient-create-target'] });
            }
            if ((url.pathname.startsWith('/api/patients') && ['PUT', 'PATCH', 'DELETE'].includes(request.method()))
                || /\/(export|backup|restore)(\/|$)/u.test(url.pathname)) disallowed.push(`${request.method()} ${url.pathname}`);
        });
        await enterImportViaNewPatient(page);
        await present(page, width, theme);
        // The only permitted download is the header-only blank template. It never contains an existing record.
        const template = page.getByRole('link', { name: 'Scarica modello CSV', exact: true });
        await expect(template).toHaveAttribute('href', /^data:text\/csv;charset=utf-8,/u);
        const downloadPromise = page.waitForEvent('download'); await template.click();
        const download = await downloadPromise;
        const stream = await download.createReadStream(); expect(stream).not.toBeNull();
        const chunks: Buffer[] = [];
        if (!stream) throw new Error('Synthetic template stream unavailable');
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).toString('utf8')).toBe(`\uFEFF${header}\r\n`);
        const otherDownloads: string[] = [];
        page.on('download', item => otherDownloads.push(item.suggestedFilename()));
        const capturedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/patients/create-context');
        await page.getByTestId('patient-bulk-file').setInputFiles(file(body));
        const contextResponse = await capturedResponse; expect(contextResponse.status()).toBe(200);
        expect(contextResponse.headers()['cache-control']).toBe('no-store');
        const captured = await contextResponse.json() as { nonce: string; ambulatoryId: string; ambulatoryName: string };
        expect(captured.ambulatoryId).toBe(before.ambulatoryId);
        const preview = page.getByTestId('patient-bulk-preview-count');
        await expect(preview).toHaveText('2 da aggiungere · 2 escluse · 4 righe totali');
        await expect(page.getByTestId('patient-bulk-destination')).toContainText(captured.ambulatoryName);
        await expect(page.getByRole('heading', { name: '2. Controlla l’anteprima', exact: true })).toBeFocused();
        await expect(page.getByTestId('patient-bulk-preview-row-3')).toContainText('Esclusa');
        await expect(page.getByTestId('patient-bulk-preview-row-4')).toContainText('già presente nell’ambulatorio');
        const confirm = page.getByRole('button', { name: 'Conferma e aggiungi 2 pazienti', exact: true });
        await expect(confirm).toBeDisabled();
        expect(creates).toHaveLength(0); expect(await list(page)).toEqual([before]);
        // Exact decrypted optional values remain visible in the actual preview.
        const firstRow = page.getByTestId('patient-bulk-preview-row-1');
        await firstRow.getByText('Altri dati riga 1', { exact: true }).click();
        await expect(firstRow).toContainText('Via Sintetica; interno 1');
        await expect(firstRow).toContainText('+390000001');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(await page.title()).not.toBe('');
        await expect(page.locator('nextjs-portal')).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`preview-${width}-${theme}.png`), fullPage: true });
        const consent = page.getByRole('checkbox', { name: 'Ho controllato l’anteprima e confermo le righe da aggiungere.', exact: true });
        await consent.focus(); await consent.press('Space'); await expect(consent).toBeChecked();
        await expect(confirm).toBeEnabled(); await confirm.focus(); await confirm.press('Enter');
        await expect(page.getByTestId('patient-bulk-result-count')).toHaveText('2 confermate · 0 sconosciute · 0 non inviate · 2 escluse');
        expect(creates).toHaveLength(2); expect(createPreconditions).toHaveLength(2);
        for (const precondition of createPreconditions) {
            expect(precondition.mode).toBe('fixed-preview-v1');
            expect(precondition.target).toBe(captured.ambulatoryId);
            expect(precondition.nonce === captured.nonce).toBe(true); // no raw nonce in diagnostics
        }
        for (const sent of creates) for (const key of ['nonce', 'createContext', 'sessionId', 'authenticationGeneration', 'cookie']) {
            expect(Object.hasOwn(sent, key)).toBe(false);
        }
        const sentFirst = creates.find(item => item.taxCode === firstCode)!;
        const sentSecond = creates.find(item => item.taxCode === secondCode)!;
        expect(sentFirst).toMatchObject({ firstName: 'Ada', lastName: 'Sintetica', birthDate: '2000-02-29T00:00:00.000Z' });
        expect(sentFirst.address).toMatch(/^ENC:/u); expect(sentFirst.phone).toMatch(/^ENC:/u);
        expect(JSON.stringify(creates)).not.toContain('Via Sintetica');
        expect(JSON.stringify(creates)).not.toContain('+390000001');
        for (const field of ['birthDate', 'address', 'phone']) expect(Object.hasOwn(sentSecond, field)).toBe(false);
        expect(new Set(creates.map(item => item.id)).size).toBe(2);
        await page.reload(); await unlockAfterReload(page);
        const after = await list(page); expect(after).toHaveLength(3);
        // Compare the whole original wire record, including timestamps/version and encrypted fields.
        expect(after.find(item => item.id === before.id)).toEqual(before);
        const savedFirst = after.find(item => item.id === sentFirst.id)!;
        const savedSecond = after.find(item => item.id === sentSecond.id)!;
        expect(savedFirst).toMatchObject({ id: sentFirst.id, firstName: 'Ada', lastName: 'Sintetica', taxCode: firstCode,
            birthDate: sentFirst.birthDate, address: sentFirst.address, phone: sentFirst.phone, ambulatoryId: before.ambulatoryId });
        expect(savedSecond).toMatchObject({ firstName: 'Elena', lastName: 'Dimostrativa', taxCode: secondCode,
            birthDate: null, address: null, phone: null, ambulatoryId: before.ambulatoryId });
        // Re-read through the actual decrypted client on reload; nothing is auto-resumed.
        await page.getByTestId('patient-bulk-file').setInputFiles(file(body));
        await expect(preview).toHaveText('0 da aggiungere · 4 escluse · 4 righe totali');
        await page.getByRole('button', { name: 'Annulla anteprima', exact: true }).click();
        await present(page, width, theme);
        await page.screenshot({ path: testInfo.outputPath(`reloaded-${width}-${theme}.png`), fullPage: true });
        expect(creates).toHaveLength(2); expect(otherDownloads).toEqual([]); expect(disallowed).toEqual([]);
        expect(external).toEqual([]); expect(errors).toEqual([]);
        await testInfo.attach('observed-batch.json', { contentType: 'application/json', body: JSON.stringify({
            synthetic: true, viewport: width, theme, themeFixtureOnly: true, initialPatients: 1, finalPatients: after.length,
            creates: creates.length, previewCreates: 0, preexistingUnchanged: true, directAuthSubstitution: false,
            encryptedAddressAndPhoneOnWire: true, plaintextDemographicsUnchangedByDesign: true,
            fixedNamedDestination: true, fencedCreates: createPreconditions.length, rawPreconditionsOmittedFromEvidence: true,
        }) });
    });
}
test('cancelled preview sends zero patient POSTs and preserves the real preexisting record', async ({ page }) => {
    await setup(page); const before = await createExistingFromUi(page);
    let creates = 0; const downloaded: string[] = [];
    page.on('request', request => { if (isPatientCreate(request)) creates += 1; });
    page.on('download', item => downloaded.push(item.suggestedFilename()));
    await enterImportViaNewPatient(page);
    await page.getByTestId('patient-bulk-file').setInputFiles(file(body));
    await expect(page.getByTestId('patient-bulk-preview-count')).toHaveText('2 da aggiungere · 2 escluse · 4 righe totali');
    await page.getByRole('button', { name: 'Annulla anteprima', exact: true }).click();
    await expect(page.getByTestId('patient-bulk-preview-count')).toHaveCount(0);
    await page.reload(); await unlockAfterReload(page);
    expect(await list(page)).toEqual([before]); expect(creates).toBe(0); expect(downloaded).toEqual([]);
});

// Real React mount/subscription/unmount/remount through the existing application shell.
// No synthetic provider or ignored console warning; run only on the jointly built candidate.
test('React lifecycle: mount, template, preview, cleanup and remount never auto-create', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
    await setup(page); const before = await createExistingFromUi(page);
    let creates = 0;
    page.on('request', request => { if (isPatientCreate(request)) creates += 1; });
    await enterImportViaNewPatient(page);
    const template = page.getByRole('link', { name: 'Scarica modello CSV', exact: true });
    const href = await template.getAttribute('href');
    expect(href?.startsWith('data:text/csv;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(href!.slice(href!.indexOf(',') + 1))).toBe(`\uFEFF${header}\r\n`);
    for (let cycle = 0; cycle < 2; cycle += 1) {
        await expect(page.getByTestId('patient-bulk-import')).toHaveAttribute('data-phase', 'idle');
        await expect(page.getByTestId('patient-bulk-file')).toBeEnabled();
        expect(creates).toBe(0);
        await page.getByTestId('patient-bulk-file').setInputFiles(file(body));
        await expect(page.getByTestId('patient-bulk-preview-count')).toHaveText('2 da aggiungere · 2 escluse · 4 righe totali');
        await page.getByRole('button', { name: 'Annulla anteprima', exact: true }).click();
        await expect(page.getByTestId('patient-bulk-preview-count')).toHaveCount(0);
        await page.getByRole('link', { name: 'Torna alla lista', exact: true }).click();
        await expect(page.getByTestId('patient-bulk-import')).toHaveCount(0);
        await enterImportViaNewPatient(page);
        await expect(template).toHaveAttribute('href', href!);
    }
    // A fresh controller/subscription renders and handles input after both cleanups.
    await page.getByTestId('patient-bulk-file').setInputFiles(file(body));
    await expect(page.getByTestId('patient-bulk-preview-count')).toHaveText('2 da aggiungere · 2 escluse · 4 righe totali');
    await page.getByRole('button', { name: 'Annulla anteprima', exact: true }).click();
    expect(await list(page)).toEqual([before]); expect(creates).toBe(0); expect(errors).toEqual([]);
    expect(await page.title()).not.toBe(''); await expect(page.locator('nextjs-portal')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('react-remount.png'), fullPage: true });
    await testInfo.attach('react-lifecycle.json', { contentType: 'application/json', body: JSON.stringify({
        synthetic: true, actualAppAndReact: true, unmountRemountCycles: 2, automaticPatientCreates: creates,
        template: 'constant-header-only-data-url-no-object-url-lifecycle',
        consoleOrPageWarnings: errors.length, authProviderSubstituted: false,
    }) });
});
