import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildPortableFabricStatusSnapshot } from '../lib/ai-providers/fabric/status';
import { FABRIC_STATUS_VERSION_HEADER, parsePortableFabricStatusEnvelope } from '../lib/ai-providers/fabric/treatment-reasoning-portable-disclosure';
import { FABRIC_VENUES } from '../lib/ai-providers/fabric/contract';
import { parseFabricSnapshotPair } from '../lib/fabric-settings-view';
import { buildFunctionStatus } from '../lib/function-status';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow } from './utils';
import { installFunctionsEgressGuard } from './fixtures/settings-functions';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';

const baseline = process.env.FABRIC_GOVERNANCE_BASELINE === '1';
const status = buildPortableFabricStatusSnapshot({ ollama: () => ({ status: 'denied', reason: 'missing' }),
    athena: () => ({ status: 'denied', reason: 'missing' }) }, { status: () => null, hardware: () => null });
const observability = { schemaVersion: 'mediflow.ai.fabric-observability.v1', fallback: 'denied_by_contract',
    observations: FABRIC_VENUES.map(venue => ({ venue, state: 'unknown', reason: 'not_probed' })) };
parseFabricSnapshotPair(parsePortableFabricStatusEnvelope(status).legacy, observability);
const functions = buildFunctionStatus({ platform: 'synthetic',
    enabled: { patient_insight: false, smart_import: false, document_synthesis: false, treatment_reasoning: false },
    ollamaLifecycle: 'missing', athenaLifecycle: 'missing', clinicalBinding: { state: 'unavailable', model: null },
    athenaArtifact: false, who: 'disabled' }, '2026-10-27T00:00:00.000Z');
const readiness = { lanes: ['patient_insight', 'smart_import', 'redaction', 'clinical_entities', 'generative_challenger']
    .map(lane => ({ lane, available: false, report: null })), localControls: [] };
const parliament = { updatedAt: '2026-10-27T00:00:00.000Z', jsonPath: '/synthetic/parliament.json',
    markdownPath: '/synthetic/parliament.md', report: { parliament: { readiness: 'hold', baselineModel: 'synthetic-model',
        rationale: 'Report sintetico in attesa di verifica.', protectedModels: [], recommendedPruneModels: [] } } };
type Scenario = 'pending' | 'status-error' | 'observation-error' | 'unauthorized' | 'forbidden' | 'ready' | 'missing' | 'error';

async function capture(page: Page, target: Locator, name: string, frames: unknown[]) {
    const directory = process.env.FABRIC_GOVERNANCE_SCREENSHOTS;
    if (!directory) throw Error('Owned screenshot directory required');
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeVisible();
    const evidence = await target.evaluate(element => {
        const r = element.getBoundingClientRect(), inset = Math.min(8, r.width / 4, r.height / 4);
        const points = [[r.x + r.width / 2, r.y + r.height / 2], [r.x + inset, r.y + inset],
            [r.right - inset, r.y + inset], [r.x + inset, r.bottom - inset], [r.right - inset, r.bottom - inset]]
            .map(([x, y]) => { const hit = document.elementFromPoint(x, y); return { x, y, hit: hit === element || !!hit && element.contains(hit) }; });
        const scrollOwners = [];
        for (let p = element.parentElement; p; p = p.parentElement)
            if (p.scrollHeight > p.clientHeight && /auto|scroll/u.test(getComputedStyle(p).overflowY))
                scrollOwners.push({ tag: p.tagName, scrollTop: p.scrollTop });
        const style = getComputedStyle(element), root = document.documentElement;
        return { theme: root.classList.contains('dark') ? 'grafite' : 'giorno',
            palette: { color: style.color, background: style.backgroundColor, bodyBackground: getComputedStyle(document.body).backgroundColor,
                inkToken: getComputedStyle(root).getPropertyValue('--lume-ink').trim() },
            rect: { x: r.x, y: r.y, right: r.right, bottom: r.bottom }, viewport: { width: innerWidth, height: innerHeight },
            points, scrollOwners, text: element.textContent?.trim().slice(0, 600) };
    });
    await mkdir(directory, { recursive: true });
    const path = `${directory}/${name}.png`;
    await page.screenshot({ path, fullPage: false });
    frames.push({ name, path, ...evidence });
    await writeFile(`${directory}/${name.split('-')[0]}-${name.split('-')[1]}-frames.json`, JSON.stringify(frames, null, 2));
    expect(evidence.rect.x, name).toBeGreaterThanOrEqual(-1);
    expect(evidence.rect.y, name).toBeGreaterThanOrEqual(-1);
    expect(evidence.rect.right, name).toBeLessThanOrEqual(evidence.viewport.width + 1);
    expect(evidence.rect.bottom, name).toBeLessThanOrEqual(evidence.viewport.height + 1);
    expect(evidence.points.every(point => point.hit), `${name}: center and inset corners`).toBe(true);
    return evidence;
}

const cases: readonly [route: 'fabric' | 'governance', scenario: Scenario][] = [
    ['fabric', 'pending'], ['fabric', 'status-error'], ['fabric', 'observation-error'],
    ['fabric', 'unauthorized'], ['fabric', 'forbidden'], ['fabric', 'ready'],
    ['governance', 'pending'], ['governance', 'missing'], ['governance', 'error'], ['governance', 'ready'],
];
for (const [route, scenario] of cases) test(`${route} read state: ${scenario}`, async ({ baseURL }) => {
    test.setTimeout(90_000);
    if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000'
        || process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR) throw Error('Owned synthetic loopback required');
    const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
    const guard = await installFunctionsEgressGuard(page, baseURL);
    const calls: { path: string; method: string }[] = [], frames: unknown[] = [], observations: unknown[] = [], errors: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    const mocked = new Set(['/api/ai/fabric/status', '/api/ai/fabric/observability', '/api/system/function-status',
        '/api/system/ai-parliament', '/api/system/ai-rollout-readiness', '/api/settings/ai/chatgpt/status']);
    await page.route('**/api/**', async request => {
        const req = request.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
        if (url.origin !== new URL(baseURL).origin || !mocked.has(path) || method !== 'GET') return request.fallback();
        calls.push({ path, method });
        if (path === '/api/ai/fabric/status') expect(req.headers()[FABRIC_STATUS_VERSION_HEADER.toLowerCase()]).toBe('2');
        if (path === '/api/settings/ai/chatgpt/status') return request.fulfill({ json: { state: 'disconnected', notice: null,
            plan: null, loginExpiresAt: null, actions: ['connect'], inferenceEnabled: false, executionBlock: 'data_boundary_unqualified' } });
        if (path === '/api/system/function-status') return request.fulfill({ json: functions });
        if (path === '/api/system/ai-rollout-readiness') return request.fulfill({ json: readiness });
        if (path === '/api/system/ai-parliament') {
            if (scenario === 'pending') await gate;
            if (scenario === 'missing') return request.fulfill({ status: 404, json: { error: 'Synthetic absent' } });
            if (scenario === 'error') return request.fulfill({ status: 503, json: { error: 'Synthetic unavailable' } });
            return request.fulfill({ json: parliament });
        }
        if (scenario === 'pending') await gate;
        const failedPath = scenario === 'observation-error' ? '/api/ai/fabric/observability' : '/api/ai/fabric/status';
        if (path === failedPath && ['status-error', 'observation-error', 'unauthorized', 'forbidden'].includes(scenario))
            return request.fulfill({ status: scenario === 'unauthorized' ? 401 : scenario === 'forbidden' ? 403 : 503,
                json: { error: 'Synthetic read failure' } });
        return request.fulfill({ json: path.endsWith('/status') ? status : observability });
    });
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        await page.goto(`/settings/ai/${route}`);
        const surface = page.getByTestId(`settings-ai-${route}-section`);
        await expect(surface).toBeVisible();
        let target: Locator;
        if (route === 'fabric') {
            const technical = surface.locator('summary').filter({ hasText: 'Dettagli tecnici: provider, connessioni e registro' });
            await expect(technical.locator('..')).not.toHaveAttribute('open');
            await expect(surface.getByTestId('function-status-panel')).toContainText('Configurazione letta il');
            const marker = scenario === 'pending' ? surface.getByTestId('fabric-loading-state') : surface.getByTestId('fabric-error-state');
            if (scenario === 'ready') {
                await expect(marker).toHaveCount(0);
                await technical.click();
                await expect(surface.getByTestId('fabric-capability-registry')).toBeVisible();
                target = surface.getByTestId('fabric-provider-section').getByRole('heading').first();
            } else {
                await expect(marker).toHaveCount(1);
                if (baseline) await expect(marker).toBeHidden(); else await expect(marker).toBeVisible();
                if (scenario === 'unauthorized') await expect(marker).toContainText('Sessione non valida');
                if (scenario === 'forbidden') await expect(marker).toContainText('Stato della Intelligence Fabric non disponibile');
                observations.push({ stateNodeCount: await marker.count(), visibleAtClosedDetails: await marker.isVisible(),
                    text: await marker.textContent(), providerSectionsVisible: await surface.getByTestId('fabric-provider-section').isVisible() });
                target = baseline ? technical : marker.locator('p').first();
            }
        } else {
            const panel = surface.getByRole('heading', { name: 'Confronto modelli AI', exact: true }).locator('..').locator('..').locator('..').locator('..');
            await expect(surface.getByTestId('ai-rollout-readiness-panel')).toContainText('Nessuna verifica');
            const loading = panel.getByText('Lettura del report salvato…', { exact: true });
            if (scenario === 'pending') {
                await expect(loading).toHaveCount(baseline ? 0 : 1);
                if (!baseline) await expect(loading).toBeVisible();
                observations.push({ loadingNodeCount: await loading.count(), reportShown: await panel.getByText('Stato confronto:', { exact: false }).count() });
                target = baseline ? panel.getByRole('heading', { name: 'Confronto modelli AI', exact: true }) : loading;
            } else if (scenario === 'error') {
                const alert = panel.getByRole('alert'), raw = alert.getByText('HTTP 503', { exact: true });
                await expect(alert).toHaveCount(1); await expect(alert).toBeVisible();
                if (baseline) await expect(raw).toBeVisible(); else {
                    await expect(alert).toContainText('Impossibile leggere il report salvato. Usa «Aggiorna» per riprovare.');
                    await expect(raw).toBeHidden();
                }
                observations.push({ rawErrorVisible: await raw.isVisible(), alertText: await alert.textContent() });
                target = alert.locator('div').first();
            } else if (scenario === 'missing') {
                target = panel.getByText('Nessun report disponibile: genera il benchmark con il comando indicato sotto.', { exact: true });
                await expect(target).toBeVisible();
            } else {
                target = panel.getByText('Stato confronto: in attesa', { exact: true });
                await expect(target).toBeVisible();
            }
        }
        await capture(page, target, `${route}-${scenario}-1440`, frames);
        const visualState = route === 'fabric' ? ['pending', 'status-error', 'unauthorized'].includes(scenario) : ['pending', 'error'].includes(scenario);
        const dayColors = new Map<number | string, string>();
        if (visualState) for (const theme of ['giorno', 'grafite']) for (const size of [320, 'zoom-400'] as const) {
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(size === 'zoom-400' ? 4 : 1);
            if (size === 320) await page.setViewportSize({ width: 320, height: 1000 });
            await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.dataset.theme = theme; }, theme);
            const evidence = await capture(page, target, `${route}-${scenario}-${theme}-${size}`, frames);
            expect(evidence.theme).toBe(theme);
            if (theme === 'giorno') dayColors.set(size, evidence.palette.color);
            else expect(evidence.palette.color, `${route}-${scenario}-${size}: distinct computed theme color`).not.toBe(dayColors.get(size));
            await assertNoHorizontalOverflow(page, [{ label: route, selector: `[data-testid="settings-ai-${route}-section"]` }]);
        }
        if (route === 'governance' && scenario === 'error' && !baseline) {
            const diagnostic = surface.getByRole('button', { name: 'Dettagli dell’errore per l’assistenza', exact: true });
            await diagnostic.focus(); await page.keyboard.press('Enter');
            await expect(surface.getByText('HTTP 503', { exact: true })).toBeVisible();
            await expect(diagnostic).toBeFocused();
            await page.keyboard.press('Space');
            await expect(surface.getByText('HTTP 503', { exact: true })).toBeHidden();
        }
        expect(guard.blocked).toEqual([]); expect(errors).toEqual([]);
        expect(calls.every(call => call.method === 'GET')).toBe(true);
    } finally {
        release();
        const directory = process.env.FABRIC_GOVERNANCE_SCREENSHOTS;
        if (directory) { await mkdir(directory, { recursive: true }); await writeFile(`${directory}/${route}-${scenario}-receipt.json`,
            JSON.stringify({ baseline, route, scenario, calls, observations, frames, blocked: guard.blocked, uiWrites: guard.mockedUiWrites, errors }, null, 2)); }
        await zoom.close();
    }
});
