import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { bootstrapUnlockedSession } from './utils';
import { installFunctionsEgressGuard } from './fixtures/settings-functions';

const baseline = process.env.SCALES_READ_BASELINE === '1';
const patientId = '10000000-0000-4000-8000-000000000001';
const patient = { id: patientId, firstName: 'Sintetica Alessandra Maria Francesca',
    lastName: 'Dimostrativa Cognome composto molto lungo per verifica visiva', taxCode: 'SNTTST80A01H501X',
    birthDate: '1980-01-01T00:00:00.000Z', createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z' };
type ReadMode = 'ready' | 'pending' | 'error' | 'empty' | 'missing';

async function installScaleReads(page: Page, baseURL?: string) {
    if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000'
        || process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR) throw Error('Owned synthetic loopback required');
    const guard = await installFunctionsEgressGuard(page, baseURL);
    const state: { list: ReadMode; patient: ReadMode } = { list: 'ready', patient: 'ready' };
    const calls: { path: string; mode: ReadMode }[] = [];
    const observations: unknown[] = [], errors: string[] = [];
    const gates = new Set<() => void>();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/patients{,/**,?*}', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        if (url.origin !== new URL(baseURL).origin || request.method() !== 'GET') return route.fallback();
        if (path !== '/api/patients' && path !== `/api/patients/${patientId}`) return route.fallback();
        const list = path === '/api/patients', mode = list ? state.list : state.patient;
        calls.push({ path, mode });
        if (mode === 'pending') await new Promise<void>(resolve => { gates.add(resolve); });
        if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'Synthetic patient read failed' } });
        if (!list && mode === 'missing') return route.fulfill({ status: 404, json: { error: 'Synthetic patient absent' } });
        return route.fulfill({ json: list ? mode === 'empty' ? [] : [patient] : patient });
    });
    return { state, calls, observations, release() { gates.forEach(resolve => resolve()); gates.clear(); },
        async finish() {
            gates.forEach(resolve => resolve()); gates.clear();
            const directory = process.env.SCALES_READ_SCREENSHOTS || test.info().outputPath('screenshots');
            await mkdir(directory, { recursive: true });
            await writeFile(`${directory}/read-receipt.json`, JSON.stringify({ baseline, calls, observations,
                blocked: guard.blocked, uiWrites: guard.mockedUiWrites, errors }, null, 2));
            expect(guard.blocked).toEqual([]); expect(errors).toEqual([]);
        } };
}

test('Scales library: search pending, error, empty, long identity and stale-term exclusion', async ({ page, baseURL }) => {
    const mock = await installScaleReads(page, baseURL);
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        for (const mode of ['pending', 'error', 'empty', 'ready'] as const) {
            mock.state.list = mode;
            await page.goto('/scales');
            await page.getByRole('button', { name: /ADL \(Indice di Katz\)/u }).click();
            const section = page.locator('#paziente'), start = section.getByRole('button', { name: /^Avvia /u });
            if (mode === 'pending' || mode === 'error') {
                await expect.poll(() => mock.calls.some(call => call.path === '/api/patients' && call.mode === mode)).toBe(true);
                await expect(start).toHaveCount(0);
                if (baseline) {
                    await expect(section.getByRole('alert')).toHaveCount(0);
                    mock.observations.push({ mode, statusTexts: await section.getByRole('status').allTextContents(),
                        busy: await section.getAttribute('aria-busy') });
                } else {
                    await expect(section.getByRole(mode === 'pending' ? 'status' : 'alert')).toHaveCount(1);
                    if (mode === 'pending') {
                        await expect(section).toHaveAttribute('aria-busy', 'true');
                        await expect(section.getByRole('status')).not.toContainText('Nessuna scheda');
                    }
                }
            } else if (mode === 'empty') {
                await expect(section.getByText('Nessuna scheda corrisponde alla ricerca.', { exact: true })).toBeVisible();
                await expect(start).toHaveCount(0);
            } else {
                await expect(start).toHaveCount(1);
                await expect(start).toHaveAccessibleName(`Avvia ADL (Indice di Katz) per ${patient.lastName} ${patient.firstName}`);
                await page.setViewportSize({ width: 320, height: 1000 });
                const name = start.locator('strong');
                const identity = await name.evaluate(element => ({ text: element.textContent, scroll: element.scrollWidth,
                    width: element.clientWidth, whiteSpace: getComputedStyle(element).whiteSpace, overflow: getComputedStyle(element).textOverflow }));
                mock.observations.push({ identity });
                if (baseline) { expect(identity.overflow).toBe('ellipsis'); expect(identity.scroll).toBeGreaterThan(identity.width); }
                else { expect(identity.whiteSpace).not.toBe('nowrap'); expect(identity.scroll).toBeLessThanOrEqual(identity.width + 1); }
                mock.state.list = 'pending';
                await section.getByRole('textbox', { name: 'Cerca paziente per nome o codice fiscale', exact: true }).fill('NessunaCorrispondenza');
                await expect.poll(() => mock.calls.filter(call => call.mode === 'pending').length).toBeGreaterThan(1);
                await expect(start).toHaveCount(baseline ? 1 : 0);
                mock.observations.push({ oldResultSelectableDuringNewTerm: await start.count() });
                mock.release();
                await expect(section.getByText('Nessuna scheda corrisponde alla ricerca.', { exact: true })).toBeVisible();
            }
            mock.release();
        }
    } finally { await mock.finish(); }
});

test('Patient scales library: pending, failed, absent and ready patient before offering start', async ({ page, baseURL }) => {
    const mock = await installScaleReads(page, baseURL);
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        for (const mode of ['pending', 'error', 'missing', 'ready'] as const) {
            mock.state.patient = mode;
            await page.goto(`/patients/${patientId}/scales`);
            await expect.poll(() => mock.calls.some(call => call.path === `/api/patients/${patientId}` && call.mode === mode)).toBe(true);
            const library = page.locator('#libreria'), links = library.getByRole('link');
            await expect(links).toHaveCount(baseline || mode === 'ready' ? 5 : 0);
            if (!baseline && mode !== 'ready') await expect(library.getByRole(mode === 'error' ? 'alert' : 'status')).toHaveCount(1);
            mock.observations.push({ mode, startLinks: await links.count() });
            mock.release();
        }
    } finally { await mock.finish(); }
});

test('Scale runner: patient pending, failure and absence never become a valid form', async ({ page, baseURL }) => {
    const mock = await installScaleReads(page, baseURL);
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        for (const mode of ['pending', 'error', 'missing', 'ready'] as const) {
            mock.state.patient = mode;
            await page.goto(`/patients/${patientId}/scales/adl`);
            await expect.poll(() => mock.calls.some(call => call.path === `/api/patients/${patientId}` && call.mode === mode)).toBe(true);
            const form = page.locator('#scala');
            if (mode === 'ready') {
                await expect(form.getByRole('radio')).not.toHaveCount(0);
                await expect(form.getByRole('button', { name: 'Avanti', exact: true })).toBeDisabled();
            } else {
                await expect(form.getByRole('radio')).toHaveCount(0);
                if (baseline || mode === 'pending') await expect(form.getByText('Caricamento paziente…', { exact: true })).toBeVisible();
                else if (mode === 'error') await expect(form.getByRole('alert')).toHaveCount(1);
                else await expect(form.getByRole('status')).not.toContainText(/Caricamento/iu);
                mock.observations.push({ mode, formAbsent: true, loadingText: await form.getByText('Caricamento paziente…', { exact: true }).isVisible() });
            }
            mock.release();
        }
    } finally { await mock.finish(); }
});
