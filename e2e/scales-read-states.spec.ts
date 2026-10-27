import { expect, test, type Page, type Locator, type Response } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bootstrapUnlockedSession, assertNotClippedInViewport } from './utils';
import { installFunctionsEgressGuard } from './fixtures/settings-functions';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';

const baseline = process.env.SCALES_READ_BASELINE === '1';
const patientId = '10000000-0000-4000-8000-000000000001';
const patient = { id: patientId, firstName: 'Sintetica Alessandra Maria Francesca',
    lastName: 'Dimostrativa Cognome composto molto lungo per verifica visiva', taxCode: 'SNTTST80A01H501X',
    birthDate: '1980-01-01T00:00:00.000Z', createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z' };
type ReadMode = 'ready' | 'pending' | 'error' | 'empty' | 'missing';
function artifactDirectory() {
    const shared = process.env.SCALES_READ_SCREENSHOTS;
    return shared ? join(shared, baseline ? 'baseline' : 'candidate', `${test.info().testId.replace(/[^a-zA-Z0-9_-]/gu, '_')}-retry-${test.info().retry}`)
        : test.info().outputPath('screenshots');
}
function requireSynthetic(baseURL?: string): asserts baseURL is string {
    if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000'
        || process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR) throw Error('Owned synthetic loopback required');
}

async function capture(page: Page, target: Locator, name: string, frames: unknown[]) {
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeVisible();
    await assertNotClippedInViewport(target, name);
    const evidence = await target.evaluate(element => {
        const rect = element.getBoundingClientRect(), inset = Math.min(8, rect.width / 4, rect.height / 4);
        const points = [[rect.x + rect.width / 2, rect.y + rect.height / 2], [rect.x + inset, rect.y + inset],
            [rect.right - inset, rect.y + inset], [rect.x + inset, rect.bottom - inset], [rect.right - inset, rect.bottom - inset]]
            .map(([x, y]) => { const hit = document.elementFromPoint(x, y); return { x, y, hit: hit === element || !!hit && element.contains(hit) }; });
        const scrollOwners = [];
        for (let p = element.parentElement; p; p = p.parentElement)
            if (p.scrollHeight > p.clientHeight && /auto|scroll/u.test(getComputedStyle(p).overflowY)) scrollOwners.push({ tag: p.tagName, scrollTop: p.scrollTop });
        return { bounds: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }, viewport: { width: innerWidth, height: innerHeight },
            color: getComputedStyle(element).color, points, scrollOwners, text: element.textContent?.trim() };
    });
    const directory = artifactDirectory(); await mkdir(directory, { recursive: true });
    const path = join(directory, `${name}.png`); await page.screenshot({ path, fullPage: false });
    frames.push({ name, path, ...evidence });
    await writeFile(join(directory, 'frames.json'), JSON.stringify(frames, null, 2));
    expect(evidence.bounds.top, name).toBeGreaterThanOrEqual(-1);
    expect(evidence.bounds.bottom, name).toBeLessThanOrEqual(evidence.viewport.height + 1);
    expect(evidence.points.every(point => point.hit), `${name}: center and inset corners`).toBe(true);
    return evidence;
}

async function layoutFrames(zoom: Awaited<ReturnType<typeof openBrowserZoomFixture>>, target: Locator, stem: string, frames: unknown[]) {
    const dayColors = new Map<number | string, string>();
    for (const theme of ['giorno', 'grafite']) for (const size of [320, 'zoom-400'] as const) {
        await zoom.page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(size === 320 ? 1 : 4);
        if (size === 320) await zoom.page.setViewportSize({ width: 320, height: 1000 });
        await zoom.page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.dataset.theme = theme; }, theme);
        const evidence = await capture(zoom.page, target, `${stem}-${theme}-${size}`, frames);
        if (theme === 'giorno') dayColors.set(size, evidence.color); else expect(evidence.color).not.toBe(dayColors.get(size));
    }
    await zoom.page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
    await zoom.page.evaluate(() => { document.documentElement.classList.remove('dark'); document.documentElement.dataset.theme = 'giorno'; });
}

async function installScaleReads(page: Page, baseURL?: string) {
    requireSynthetic(baseURL);
    const guard = await installFunctionsEgressGuard(page, baseURL);
    const state: { list: ReadMode; patient: ReadMode } = { list: 'ready', patient: 'ready' };
    const calls: { sequence: number; path: string; mode: ReadMode }[] = [];
    const observations: unknown[] = [], errors: string[] = [], frames: unknown[] = [];
    const completed: { sequence: number; path: string; status: number; finished: true }[] = [];
    const gates = new Set<() => void>();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/patients{,/**,?*}', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        if (url.origin !== new URL(baseURL).origin || request.method() !== 'GET') return route.fallback();
        if (path !== '/api/patients' && path !== `/api/patients/${patientId}`) return route.fallback();
        const list = path === '/api/patients', mode = list ? state.list : state.patient;
        const sequence = calls.length + 1, headers = { 'x-scales-fixture-read': String(sequence) };
        calls.push({ sequence, path, mode });
        if (mode === 'pending') await new Promise<void>(resolve => { gates.add(resolve); });
        if (mode === 'error') return route.fulfill({ status: 503, headers, json: { error: 'Synthetic patient read failed' } });
        if (!list && mode === 'missing') return route.fulfill({ status: 404, headers, json: { error: 'Synthetic patient absent' } });
        return route.fulfill({ headers, json: list ? mode === 'empty' ? [] : [patient] : patient });
    });
    async function finished(response: Response) {
        expect(await response.finished()).toBeNull();
        completed.push({ sequence: Number(response.headers()['x-scales-fixture-read']), path: new URL(response.url()).pathname, status: response.status(), finished: true });
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    }
    const release = () => { gates.forEach(resolve => resolve()); gates.clear(); };
    return { state, calls, observations, frames, release,
        async observeRead(path: string, mode: ReadMode, action: () => Promise<unknown>) {
            const after = calls.length;
            if (mode === 'pending') {
                await action();
                await expect.poll(() => calls.some(call => call.sequence > after && call.path === path && call.mode === mode)).toBe(true);
                return;
            }
            const response = page.waitForResponse(response => new URL(response.url()).pathname === path
                && response.request().method() === 'GET' && Number(response.headers()['x-scales-fixture-read']) > after);
            const [received] = await Promise.all([response, action()]);
            expect(received.status()).toBe(mode === 'error' ? 503 : mode === 'missing' ? 404 : 200);
            await finished(received);
        },
        async releaseAndFinish(path: string) {
            const sequence = calls.filter(call => call.path === path && call.mode === 'pending').at(-1)?.sequence;
            if (!sequence) throw Error('Held read required');
            const response = page.waitForResponse(response => Number(response.headers()['x-scales-fixture-read']) === sequence);
            release(); await finished(await response);
        },
        async finish() {
            gates.forEach(resolve => resolve()); gates.clear();
            const directory = artifactDirectory();
            await mkdir(directory, { recursive: true });
            await writeFile(`${directory}/read-receipt.json`, JSON.stringify({ baseline, directory, testId: test.info().testId,
                retry: test.info().retry, calls, completed, observations, frames,
                blocked: guard.blocked, uiWrites: guard.mockedUiWrites, errors }, null, 2));
            expect(guard.blocked).toEqual([]); expect(errors).toEqual([]);
        } };
}

test('Scales library: search pending, error, empty, long identity and stale-term exclusion', async ({ baseURL }) => {
    test.setTimeout(120_000);
    requireSynthetic(baseURL);
    const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
    const mock = await installScaleReads(page, baseURL);
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        for (const mode of ['pending', 'error', 'empty', 'ready'] as const) {
            mock.state.list = mode;
            await mock.observeRead('/api/patients', mode, async () => {
                await page.goto('/scales');
                await page.getByRole('button', { name: /ADL \(Indice di Katz\)/u }).click();
            });
            const section = page.locator('#paziente'), start = section.getByRole('button', { name: /^Avvia /u });
            if (mode === 'pending' || mode === 'error') {
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
                const target = baseline ? section.getByRole('heading', { name: 'Scegli il paziente', exact: true })
                    : section.getByRole(mode === 'pending' ? 'status' : 'alert');
                await capture(page, target, `search-${mode}-1440`, mock.frames);
                if (mode === 'error') await layoutFrames(zoom, target, 'search-error', mock.frames);
            } else if (mode === 'empty') {
                await expect(section.getByText('Nessuna scheda corrisponde alla ricerca.', { exact: true })).toBeVisible();
                await expect(start).toHaveCount(0);
                await capture(page, section.getByRole('status'), 'search-empty-1440', mock.frames);
            } else {
                await expect(start).toHaveCount(1);
                await expect(start).toHaveAccessibleName(`Avvia ADL (Indice di Katz) per ${patient.lastName} ${patient.firstName}`);
                const name = start.locator('strong');
                await capture(page, name, 'search-identity-1440', mock.frames);
                await layoutFrames(zoom, name, 'search-long-identity', mock.frames);
                await page.setViewportSize({ width: 320, height: 1000 });
                const identity = await name.evaluate(element => ({ text: element.textContent, scroll: element.scrollWidth,
                    width: element.clientWidth, whiteSpace: getComputedStyle(element).whiteSpace, overflow: getComputedStyle(element).textOverflow }));
                mock.observations.push({ identity });
                if (baseline) { expect(identity.overflow).toBe('ellipsis'); expect(identity.scroll).toBeGreaterThan(identity.width); }
                else { expect(identity.whiteSpace).not.toBe('nowrap'); expect(identity.scroll).toBeLessThanOrEqual(identity.width + 1); }
                if (!baseline) {
                    const search = section.getByRole('textbox', { name: 'Cerca paziente per nome o codice fiscale', exact: true });
                    await search.scrollIntoViewIfNeeded();
                    const inputLayout = await search.evaluate(input => {
                        const rect = input.getBoundingClientRect(), icon = input.parentElement!.querySelector('svg')!.getBoundingClientRect();
                        return { textStart: rect.left + parseFloat(getComputedStyle(input).paddingLeft), iconRight: icon.right };
                    });
                    mock.observations.push({ inputLayout });
                    expect(inputLayout.textStart).toBeGreaterThan(inputLayout.iconRight);
                }
                mock.state.list = 'pending';
                await mock.observeRead('/api/patients', 'pending', () => section.getByRole('textbox',
                    { name: 'Cerca paziente per nome o codice fiscale', exact: true }).fill('NessunaCorrispondenza'));
                await expect(start).toHaveCount(baseline ? 1 : 0);
                mock.observations.push({ oldResultSelectableDuringNewTerm: await start.count() });
                await capture(page, baseline ? name : section.getByRole('status'), 'search-new-term-pending-320', mock.frames);
                await mock.releaseAndFinish('/api/patients');
                await expect(section.getByText('Nessuna scheda corrisponde alla ricerca.', { exact: true })).toBeVisible();
                await capture(page, section.getByRole('status'), 'search-new-term-complete-320', mock.frames);
            }
            mock.release();
        }
    } finally { try { await mock.finish(); } finally { await zoom.close(); } }
});

test('Patient scales library: pending, failed, absent and ready patient before offering start', async ({ baseURL }) => {
    test.setTimeout(120_000);
    requireSynthetic(baseURL);
    const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
    const mock = await installScaleReads(page, baseURL);
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        for (const mode of ['pending', 'error', 'missing', 'ready'] as const) {
            mock.state.patient = mode;
            await mock.observeRead(`/api/patients/${patientId}`, mode, () => page.goto(`/patients/${patientId}/scales`));
            const library = page.locator('#libreria'), links = library.getByRole('link');
            await expect(links).toHaveCount(baseline || mode === 'ready' ? 5 : 0);
            if (!baseline && mode !== 'ready') await expect(library.getByRole(mode === 'error' ? 'alert' : 'status')).toHaveCount(1);
            mock.observations.push({ mode, startLinks: await links.count() });
            const target = baseline && mode !== 'ready' ? page.getByRole('heading', { name: 'Scale cliniche', exact: true })
                : mode === 'ready' ? links.first() : library.getByRole(mode === 'error' ? 'alert' : 'status');
            await capture(page, target, `patient-library-${mode}-1440`, mock.frames);
            if (mode === 'missing') await layoutFrames(zoom, target, 'patient-library-missing', mock.frames);
            mock.release();
        }
    } finally { try { await mock.finish(); } finally { await zoom.close(); } }
});

test('Scale runner: patient pending, failure and absence never become a valid form', async ({ baseURL }) => {
    test.setTimeout(120_000);
    requireSynthetic(baseURL);
    const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
    const mock = await installScaleReads(page, baseURL);
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        for (const mode of ['pending', 'error', 'missing', 'ready'] as const) {
            mock.state.patient = mode;
            await mock.observeRead(`/api/patients/${patientId}`, mode, () => page.goto(`/patients/${patientId}/scales/adl`));
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
            const target = mode === 'ready' ? form.locator('legend h3') : form.getByRole(!baseline && mode === 'error' ? 'alert' : 'status');
            await capture(page, target, `runner-${mode}-1440`, mock.frames);
            if (mode === 'error') await layoutFrames(zoom, target, 'runner-error', mock.frames);
            mock.release();
        }
    } finally { try { await mock.finish(); } finally { await zoom.close(); } }
});
