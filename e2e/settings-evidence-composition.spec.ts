import { closureGallery, settingsClosure } from './fixtures/settings-closure-gallery';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow } from './utils';

const providerSettings = Object.freeze({ aiProvider: 'ollama', aiUrl: 'http://127.0.0.1:11434', ollamaUrl: 'http://127.0.0.1:11434' });
async function installSettingsEvidenceMocks(page: Page, baseURL: string) {
    const origin = new URL(baseURL).origin;
    if (new URL(baseURL).hostname !== '127.0.0.1' || (process.env.SETTINGS_CLOSURE === '1' && new URL(baseURL).port !== '3000')) throw Error('Explicit synthetic loopback runtime required');
    const state: { models: 'ready' | 'error'; who: 'disabled' | 'available' | 'configured' | 'configuration_required' | 'credentials_absent' | 'offline' | 'unavailable'; update: 'available' | 'absent' | 'error' } = { models: 'ready', who: 'disabled', update: 'available' };
    const calls: Array<{ method: string; pathname: string; state: typeof state }> = [];
    const blocked: Array<{ method: string; url?: string; pathname?: string; search?: boolean }> = [];
    const update = Object.freeze({ currentVersion: '0.9.1-synthetic', availableVersion: '0.9.1-synthetic-next', updateAvailable: true,
        source: 'local-manifest', channel: 'synthetic', updateUrl: 'https://example.invalid/mediflow-update',
        notes: ['SYNTHETIC SOFTWARE FIXTURE'], changelogTitle: 'SYNTHETIC', branch: 'fixture', revision: 'fixture' });
    const handler = async (route: import('@playwright/test').Route) => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) { blocked.push({ method: request.method(), url: request.url() }); return route.abort(); }
        const pathname = url.pathname;
        const controlled = pathname === '/api/ai/models' || pathname === '/api/icd/proxy'
            || pathname === '/api/system/update-awareness' || pathname === '/api/siss/session-status'
            || Object.keys(providerSettings).some(key => pathname === `/api/settings/${key}`);
        if (controlled && request.method() !== 'GET') { blocked.push({ method: request.method(), pathname }); return route.abort(); }
        if (controlled) calls.push({ method: request.method(), pathname, state: { ...state } });
        if (pathname === '/api/siss/session-status') return route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } });
        const key = pathname.slice('/api/settings/'.length);
        if (pathname.startsWith('/api/settings/') && Object.hasOwn(providerSettings, key)) return route.fulfill({ json: { key, value: providerSettings[key as keyof typeof providerSettings] } });
        if (pathname === '/api/ai/models') return state.models === 'ready'
            ? route.fulfill({ json: { models: [] } }) : route.fulfill({ status: 503, json: { error: 'SYNTHETIC UNAVAILABLE' } });
        if (pathname === '/api/icd/proxy') {
            if (url.search) { blocked.push({ method: request.method(), pathname, search: true }); return route.abort(); }
            return route.fulfill({ json: { schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1', status: state.who, releaseId: '2026-01', language: 'en' } });
        }
        if (pathname === '/api/system/update-awareness') return state.update === 'error'
            ? route.fulfill({ status: 503, json: { error: 'SYNTHETIC UNAVAILABLE' } })
            : route.fulfill({ json: state.update === 'available' ? update : { ...update, availableVersion: null, updateAvailable: false, updateUrl: null } });
        if (pathname.startsWith('/api/ai/') || pathname.startsWith('/api/icd/')) { blocked.push({ method: request.method(), pathname }); return route.abort(); }
        return route.continue();
    };
    await page.route('**/*', handler);
    return { state, calls, blocked, close: () => page.unroute('**/*', handler) };
}

test('Settings evidence: composition, disclosed checks and failed update reread', async ({ baseURL }) => {
    test.setTimeout(settingsClosure ? 480_000 : 120_000);
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR) throw Error('Explicit synthetic runtime required');
    const zoom = await openBrowserZoomFixture(baseURL!), page = zoom.page;
    const fixture = await installSettingsEvidenceMocks(page, baseURL!);
    const directory = process.env.SETTINGS_EVIDENCE_SCREENSHOTS;
    const frames: unknown[] = [], sectionTitles: unknown[] = [], errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const capture = async (name: string, target: Locator) => {
        await target.scrollIntoViewIfNeeded();
        const probe = await target.evaluate(element => {
            const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + Math.min(rect.height / 2, 20));
            const root = getComputedStyle(document.documentElement);
            return { text: element.textContent, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                viewport: { width: innerWidth, height: innerHeight }, centerHit: hit === element || element.contains(hit),
                clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, textOverflow: style.textOverflow, fontSize: style.fontSize,
                palette: { classes: document.documentElement.className, storage: localStorage.getItem('mediflow-theme'),
                    ink: root.getPropertyValue('--lume-ink'), surface: root.getPropertyValue('--lume-surface-field'),
                    foreground: style.color, background: getComputedStyle(document.body).backgroundColor } };
        });
        expect(probe.centerHit).toBe(true);
        frames.push({ name, ...probe });
        if (directory) { await mkdir(directory, { recursive: true }); await page.screenshot({ path: `${directory}/${name}.png`, fullPage: false, animations: 'disabled' }); }
        return probe;
    };
    const sectionTitle = async (heading: Locator) => {
        await expect(heading).toHaveCSS('font-size', '12px');
        sectionTitles.push(await heading.evaluate(element => ({ text: element.textContent, fontSize: getComputedStyle(element).fontSize, caps: getComputedStyle(element).fontVariantCaps })));
    };
    const gallery = async (route: string, target: Locator) => {
        if (!directory) return;
        const palettes = new Map<string, string>();
        for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
            if (size.startsWith('zoom-')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4);
            else await page.setViewportSize({ width: Number(size), height: 1000 });
            await page.evaluate(theme => {
                const value = theme === 'giorno' ? 'light' : 'dark';
                localStorage.setItem('mediflow-theme', value);
                document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(value);
                document.documentElement.style.colorScheme = value;
            }, theme);
            await assertNoHorizontalOverflow(page, [{ label: route, selector: 'document' }]);
            const probe = await capture(`${route}-${theme}-${size}`, target);
            expect(probe.fontSize).toBe('12px');
            expect(probe.palette.storage).toBe(theme === 'giorno' ? 'light' : 'dark');
            expect(probe.palette.classes).toMatch(new RegExp(`\\b${theme === 'giorno' ? 'light' : 'dark'}\\b`));
            if (size === '1440') palettes.set(theme, probe.palette.foreground);
        }
        expect(palettes.get('giorno')).not.toBe(palettes.get('grafite'));
        await zoom.setZoom(1); await page.setViewportSize({ width: 1440, height: 1000 });
    };
    let releaseRead: (() => void) | undefined, releaseWho: (() => void) | undefined;
    try {
        await bootstrapUnlockedSession(page, '1234');
        await page.goto('/settings/compliance');
        const compliance = page.getByTestId('settings-compliance-section');
        await expect(compliance).toBeVisible();
        await gallery('compliance', compliance.getByRole('heading', { name: 'Evidenze e conformità', exact: true }));
        for (const heading of await compliance.getByRole('heading').all()) await sectionTitle(heading);
        const records = compliance.locator('[data-testid^="compliance-evidence-"]');
        await expect(records).toHaveCount(6);
        for (const record of await records.all()) {
            const status = record.locator('[data-compliance-status]'), limitation = record.locator('dd').first();
            await capture(await record.getAttribute('data-testid') ?? 'record', status);
            await expect(status).toBeVisible(); await expect(limitation).toBeVisible();
            const control = record.getByRole('button', { name: 'Evidenze, responsabile e fonti', exact: true });
            await expect(control).toHaveAttribute('aria-expanded', 'false');
            await control.focus(); await control.press('Enter'); await expect(control).toBeFocused();
            await expect(control).toHaveAttribute('aria-expanded', 'true');
            await closureGallery(page, zoom, directory, `${await record.getAttribute('data-testid')}-dettagli`, control);
            await control.press('Enter'); await expect(control).toHaveAttribute('aria-expanded', 'false');
            await expect(status).toBeVisible(); await expect(limitation).toBeVisible();
        }
        await page.goto('/settings/diagnostica');
        const diagnostics = page.getByTestId('settings-diagnostics-section');
        await expect(page.getByTestId('diagnostic-service-ai')).toContainText('Raggiungibile');
        await expect(page.getByTestId('diagnostic-service-icd')).toContainText('Disattivato');
        const updates = page.getByTestId('settings-update-awareness-panel');
        await expect(updates).toContainText('0.9.1-synthetic-next');
        for (const name of ['Diagnostica', 'Servizi della postazione', 'Aggiornamenti']) await sectionTitle(diagnostics.getByRole('heading', { name, exact: true }));
        await gallery('diagnostica', diagnostics.getByRole('heading', { name: 'Diagnostica', exact: true }));
        await expect(diagnostics.getByRole('button', { name: 'Esegui Test Completo', exact: true })).toHaveCount(0);
        await expect(diagnostics.locator('[data-diagnostic-check]')).toHaveCount(4);
        const checks = diagnostics.getByRole('button', { name: 'Diagnostica di Sistema', exact: true });
        await checks.focus(); await checks.press('Enter'); await expect(checks).toBeFocused();
        await sectionTitle(diagnostics.getByRole('heading', { name: 'Diagnostica di Sistema', exact: true }));
        await sectionTitle(checks);
        await expect(diagnostics.locator('[data-settings-primary="true"]:visible')).toHaveCount(1);
        if (settingsClosure) for (const id of ['db', 'ai', 'api'])
            await closureGallery(page, zoom, directory, `${id}-non-verificato`, diagnostics.locator(`[data-diagnostic-check="${id}"]`).getByRole('status'));
        const who = diagnostics.locator('[data-diagnostic-check="icd"]');
        await expect(who.getByRole('status')).toHaveText('Non ancora verificato');
        await who.getByRole('button', { name: 'Esegui singolo test: ICD-11 WHO', exact: true }).click();
        await expect(who.getByRole('alert')).toHaveText('Servizio WHO ICD-11 disattivato.');
        await capture('who-error', who.getByRole('alert'));
        expect(await who.getByRole('alert').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
        await closureGallery(page, zoom, directory, 'who-disattivato', who.getByRole('alert'));
        await checks.click(); await checks.click();
        await expect(who.getByRole('alert')).toHaveText('Servizio WHO ICD-11 disattivato.');
        fixture.state.who = 'available';
        const whoPending = new Promise<void>(resolve => { releaseWho = resolve; });
        const holdWho = async (route: import('@playwright/test').Route) => { await whoPending; await route.fallback(); };
        await page.route('**/api/icd/proxy', holdWho);
        const whoAction = who.getByRole('button', { name: 'Esegui singolo test: ICD-11 WHO', exact: true });
        await whoAction.click();
        await expect(who.getByRole('status')).toHaveText('Verifica in corso');
        await expect(whoAction).toBeDisabled();
        await closureGallery(page, zoom, directory, 'who-in-corso', who.getByRole('status'));
        releaseWho!();
        await expect(who.getByRole('status')).toContainText(/Risposta ricevuta in \d+ ms/);
        await expect(whoAction).toBeEnabled();
        await page.unroute('**/api/icd/proxy', holdWho);
        await closureGallery(page, zoom, directory, 'who-disponibile', who.getByRole('status'));
        if (settingsClosure) {
            for (const status of ['configured', 'configuration_required', 'credentials_absent', 'offline', 'unavailable'] as const) {
                fixture.state.who = status;
                await whoAction.click(); await expect(who.getByRole('alert')).toBeVisible();
                await closureGallery(page, zoom, directory, `who-${status}`, who.getByRole('alert'));
            }
            for (const id of ['db', 'ai', 'api']) {
                const row = diagnostics.locator(`[data-diagnostic-check="${id}"]`);
                const endpoint = id === 'db' ? '**/api/auth/check' : id === 'ai' ? '**/api/ai/models' : '**/api/settings/aiProvider';
                let finish!: () => void;
                const pending = new Promise<void>(resolve => { finish = resolve; });
                const hold = async (route: import('@playwright/test').Route) => { await pending; await route.fallback(); };
                await page.route(endpoint, hold);
                try {
                    await row.getByRole('button').click(); await expect(row.getByRole('status')).toHaveText('Verifica in corso');
                    await closureGallery(page, zoom, directory, `${id}-in-corso`, row.getByRole('status'));
                } finally { finish(); }
                await expect(row.getByRole('status')).toContainText('Risposta ricevuta');
                await page.unroute(endpoint, hold);
                await closureGallery(page, zoom, directory, `${id}-risposta`, row.getByRole('status'));
            }
            for (const [id, endpoint] of [['db', '**/api/auth/check'], ['api', '**/api/settings/aiProvider']]) {
                const fail = async (route: import('@playwright/test').Route) => {
                    const response = await route.fetch();
                    await route.fulfill({ response, status: 503, json: { error: 'Indisponibile' } });
                };
                await page.route(endpoint, fail);
                const row = diagnostics.locator(`[data-diagnostic-check="${id}"]`);
                await row.getByRole('button').click(); await expect(row.getByRole('alert')).toBeVisible();
                await closureGallery(page, zoom, directory, `${id}-errore`, row.getByRole('alert'));
                await page.unroute(endpoint, fail);
            }
            fixture.state.models = 'error';
            const ai = diagnostics.locator('[data-diagnostic-check="ai"]');
            await ai.getByRole('button').click(); await expect(ai.getByRole('alert')).toBeVisible();
            await closureGallery(page, zoom, directory, 'ai-errore', ai.getByRole('alert'));
        }

        fixture.state.update = 'error';
        const denied = page.waitForResponse(response => new URL(response.url()).pathname === '/api/system/update-awareness' && response.status() === 503);
        await updates.getByRole('button', { name: 'Aggiorna stato', exact: true }).click(); await denied;
        await expect(updates.getByRole('alert')).toContainText('Impossibile aggiornare lo stato. È mostrato l’ultimo valore letto.');
        await expect(updates.getByRole('alert')).toContainText('Errore: HTTP 503');
        await expect(updates).toContainText('0.9.1-synthetic-next');
        await capture('update-reread-503', updates);
        await closureGallery(page, zoom, directory, 'update-rilettura-negata', updates.getByRole('alert'));
        await expect(updates.getByRole('link', { name: 'Apri aggiornamento', exact: true })).not.toHaveClass(/ui-btn-primary/);
        fixture.state.update = 'absent';
        const pending = new Promise<void>(resolve => { releaseRead = resolve; });
        const hold = async (route: import('@playwright/test').Route) => { await pending; await route.fallback(); };
        await page.route('**/api/system/update-awareness', hold);
        await updates.getByRole('button', { name: 'Aggiorna stato', exact: true }).click();
        await expect(updates).toHaveAttribute('aria-busy', 'true');
        await expect(updates.getByRole('status')).toHaveText('Lettura stato aggiornamenti...');
        await closureGallery(page, zoom, directory, 'update-in-corso', updates.getByRole('status'));
        releaseRead!(); await expect(updates).toHaveAttribute('aria-busy', 'false');
        await page.unroute('**/api/system/update-awareness', hold);
        await expect(updates.getByRole('alert')).toHaveCount(0);
        await expect(updates.getByRole('link', { name: 'Apri aggiornamento', exact: true })).toHaveCount(0);
        fixture.state.update = 'available';
        await updates.getByRole('button', { name: 'Aggiorna stato', exact: true }).click();
        await updates.getByRole('button', { name: 'Piu tardi', exact: true }).click();
        await expect(updates).toContainText('Avviso rimandato per questa versione.');
        await closureGallery(page, zoom, directory, 'update-rimandato', updates.getByText('Avviso rimandato per questa versione.', { exact: true }));
        expect(errors).toEqual([]); expect(fixture.blocked).toEqual([]);
    } finally {
        releaseRead?.(); releaseWho?.();
        try {
            await test.info().attach('settings-evidence-observations.json', { body: JSON.stringify({ frames, sectionTitles, errors, calls: fixture.calls, allBlocked: fixture.blocked }), contentType: 'application/json' });
            if (directory) { await mkdir(directory, { recursive: true }); await writeFile(`${directory}/surfaces.json`, JSON.stringify({ frames, sectionTitles, errors, calls: fixture.calls, allBlocked: fixture.blocked }, null, 2)); }
        } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await zoom.close(); }
    }
});


test('Settings evidence: aggiornamenti non leggibili alla prima apertura', async ({ baseURL }) => {
    test.setTimeout(90_000);
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR) throw Error('Archivio sintetico richiesto');
    const zoom = await openBrowserZoomFixture(baseURL!), page = zoom.page;
    const fixture = await installSettingsEvidenceMocks(page, baseURL!);
    try {
        await bootstrapUnlockedSession(page, '1234'); fixture.state.update = 'error';
        await page.goto('/settings/diagnostica');
        const updates = page.getByTestId('settings-update-awareness-panel');
        await expect(updates.getByRole('alert')).toContainText('Errore: HTTP 503');
        await expect(updates).not.toContainText('0.9.1-synthetic-next');
        await closureGallery(page, zoom, process.env.SETTINGS_EVIDENCE_SCREENSHOTS, 'update-prima-lettura-negata', updates.getByRole('alert'));
        expect(fixture.blocked).toEqual([]);
    } finally { await fixture.close(); await zoom.close(); }
});
