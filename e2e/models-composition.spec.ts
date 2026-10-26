import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildFunctionStatus } from '../lib/function-status';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow } from './utils';

const clinical = 'synthetic-clinical:latest', reasoning = 'synthetic-reasoning:latest';
const baseline = process.env.MODELS_COMPOSITION_BASELINE === '1';
async function installClosedMocks(page: Page, baseURL: string) {
    const config = new Map<string, unknown>(Object.entries({ aiModelDefaultVersion: 'qwen35-default-v1', aiProvider: 'ollama', hardwareProfile: 'custom', aiModel_clinical: clinical, aiModel_reasoning: reasoning, aiModel: clinical, aiUrl: 'http://127.0.0.1:11434/v1', ollamaUrl: 'http://127.0.0.1:11434/v1', aiInsightMode: 'balanced', aiInsightManualConfig: JSON.stringify({ maxDocuments: 6, maxDocumentSummaryChars: 260, maxDocumentContextChars: 2200, outputMaxTokens: 512 }), aiPatientInsightKillSwitch: 'disabled', aiDocumentSynthesisKillSwitch: 'disabled', aiSmartImportKillSwitch: 'disabled', aiTreatmentReasoningKillSwitch: 'disabled' }));
    const calls: Array<{ path: string; method: string; body?: unknown; target?: string }> = [], blocked: string[] = [], writes: unknown[] = [];
    let releaseSettings: () => void = () => {};
    const settingsGate = new Promise<void>(resolve => { releaseSettings = resolve; });
    const state = { holdSettings: false, accountWaiting: false, catalog: 'present' as 'present' | 'empty' | 'error', settingsFailed: false, failSave: false, version: 0, activated: false };
    const onboarding = () => ({ provider: 'ollama', credentialClass: 'local_model', model: config.get('aiModel_clinical'), state: state.activated ? 'available_unqualified' : 'missing', revision: (state.activated ? 'b' : 'a').repeat(64), version: state.version, receipt: state.activated ? `receipt_${'b'.repeat(32)}` : null, canActivate: true, inference: 'not_run', qualification: 'not_assessed' });
    const accountStatus = () => ({ state: state.accountWaiting ? 'awaiting_login' : 'disconnected', notice: null, plan: null, loginExpiresAt: state.accountWaiting ? 2_000_000_000_000 : null, actions: state.accountWaiting ? ['cancel_login'] : ['connect'], inferenceEnabled: false, executionBlock: 'data_boundary_unqualified' });
    await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
        if (url.origin !== new URL(baseURL).origin) { blocked.push(request.url()); return route.abort(); }
        const record = (body?: unknown) => calls.push({ path, method, ...(body === undefined ? {} : { body }), ...(request.headers()['x-target-url'] ? { target: request.headers()['x-target-url'] } : {}) });
        if (path === '/api/plugin-local-ui/pairing' && method === 'GET') return route.fulfill({ json: { available: false, pending: [], active: [] } });
        if (path === '/api/siss/session-status') return route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } });
        if (path.startsWith('/api/settings/ai/chatgpt/')) {
            record();
            if (method === 'POST' && path === '/api/settings/ai/chatgpt/login/start') { state.accountWaiting = true; return route.fulfill({ json: { status: accountStatus(), authUrl: 'https://auth.openai.com/oauth/authorize?state=synthetic-fixture' } }); }
            if (method === 'POST' && path === '/api/settings/ai/chatgpt/login/cancel') { state.accountWaiting = false; return route.fulfill({ json: { status: accountStatus() } }); }
            if (path !== '/api/settings/ai/chatgpt/status' || method !== 'GET') { blocked.push(`${method} ${path}`); return route.abort(); }
            return route.fulfill({ json: accountStatus() });
        }
        if (path === '/api/settings' || path.startsWith('/api/settings/')) {
            const body = method === 'GET' ? undefined : request.postDataJSON();
            const key = path.startsWith('/api/settings/') ? decodeURIComponent(path.slice('/api/settings/'.length)) : body?.key;
            if (typeof key === 'string' && (/^(ai|ollama|documentRouter)/u.test(key) || key === 'hardwareProfile')) {
                record(body);
                if (method === 'GET' && state.holdSettings) await settingsGate;
                if (method === 'GET') return state.settingsFailed ? route.fulfill({ status: 500, json: { error: 'Configurazione sintetica indisponibile' } }) : route.fulfill({ json: { key, value: config.get(key) ?? null } });
                writes.push(body);
                if (state.failSave) return route.fulfill({ status: 503, json: { error: 'Salvataggio sintetico non confermato' } });
                config.set(key, body.value); return route.fulfill({ json: { success: true, key, value: body.value } });
            }
        }
        if (path === '/api/ai/models') {
            record();
            if (method !== 'GET') { blocked.push(`${method} ${path}`); return route.abort(); }
            return state.catalog === 'error' ? route.fulfill({ status: 503, json: { error: 'Catalogo sintetico indisponibile' } }) : route.fulfill({ json: { models: state.catalog === 'empty' ? [] : [{ name: clinical, size: null }, { name: reasoning, size: null }] } });
        }
        if (path === '/api/ai/local-provider/onboarding') {
            const body = method === 'POST' ? request.postDataJSON() : undefined; record(body);
            if (method === 'POST') { expect(body).toEqual({ intent: 'verify_and_activate', expectedRevision: onboarding().revision }); state.activated = true; state.version++; }
            else if (method !== 'GET') { blocked.push(`${method} ${path}`); return route.abort(); }
            return route.fulfill({ json: onboarding() });
        }
        if (path === '/api/system/function-status') { record(); return route.fulfill({ json: buildFunctionStatus({ platform: 'synthetic', enabled: { patient_insight: false, smart_import: false, document_synthesis: false, treatment_reasoning: false }, ollamaLifecycle: 'available_unqualified', athenaLifecycle: 'missing', clinicalBinding: { state: 'configured', model: String(config.get('aiModel_clinical')) }, athenaArtifact: false, who: 'disabled' }, '2026-10-26T12:00:00.000Z') }); }
        if (path === '/api/system/ai-rollout-readiness') { record(); return route.fulfill({ json: { lanes: ['patient_insight', 'smart_import', 'redaction', 'clinical_entities', 'generative_challenger'].map(lane => ({ lane, available: false, report: null })), localControls: ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'].map(lane => ({ lane, label: lane, state: 'disabled' })) } }); }
        if (path.startsWith('/api/') && /(?:ai|ollama|mlx|model|provider|download|runtime)/iu.test(path)) { blocked.push(`${method} ${path}`); return route.abort(); }
        return route.continue();
    });
    return { config, calls, blocked, writes, state, onboarding, releaseSettings };
}

test('Modelli: letture chiuse, scelta e bozza, gerarchia e attivazione soltanto simulata', async ({ baseURL }) => {
    test.setTimeout(180_000);
    if (process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR || !baseURL || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000') throw new Error('Runtime e archivio sintetici isolati richiesti');
    const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
    const mock = await installClosedMocks(page, baseURL), errors: string[] = [], directory = process.env.MODELS_COMPOSITION_SCREENSHOTS;
    const causal = process.env.MODELS_COMPOSITION_CAUSAL === '1';
    const frames: unknown[] = [];
    const focus: unknown[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const region = page.getByTestId('settings-ai-models-section'), save = page.getByRole('button', { name: 'Salva configurazione', exact: true });
    const selector = (id: string) => page.getByTestId(`ai-model-selector-${id}`);
    const capture = async (state: string) => {
        if (causal || (process.env.MODELS_COMPOSITION_CAPTURE_ONLY && process.env.MODELS_COMPOSITION_CAPTURE_ONLY !== state)) return;
        if (directory) await mkdir(directory, { recursive: true });
        for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
            if (size.startsWith('zoom-')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4); else await page.setViewportSize({ width: Number(size), height: 1000 });
            await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.classList.toggle('light', theme === 'giorno'); }, theme);
            const anchor = state === 'collegamento' ? page.getByRole('button', { name: 'Verifica e attiva locale', exact: true }) : state === 'account' ? page.getByRole('button', { name: 'Collega ChatGPT', exact: true }) : state === 'bozza' ? save : ['modelli', 'errore', 'vuoto'].includes(state) ? selector('clinical') : page.getByRole('heading', { name: 'Modelli e hardware', exact: true });
            await anchor.evaluate(element => element.scrollIntoView({ block: 'center' }));
            if (!baseline) {
                const headings = await region.locator('h2, h3').evaluateAll(elements => elements.filter(element => element.tagName === 'H2' || /^[1-4]\./u.test(element.textContent ?? '')).map(element => ({ text: element.textContent, size: getComputedStyle(element).fontSize })));
                expect(headings.length).toBeGreaterThanOrEqual(5);
                expect(headings).toEqual(headings.map(heading => ({ ...heading, size: '12px' })));
                const controls = await region.locator('button').evaluateAll(elements => elements.filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; }).map(element => ({ text: element.textContent, height: element.getBoundingClientRect().height })));
                expect(controls.every(control => control.height >= 40)).toBe(true);
            }
            await assertNoHorizontalOverflow(page, [{ label: 'pagina', selector: 'document' }, { label: 'modelli', selector: '[data-testid="settings-ai-models-section"]' }]);
            if (directory) {
                const path = `${directory}/${theme}-${size}-${state}.png`;
                const pixels = await page.screenshot({ path, fullPage: false, animations: 'disabled' });
                const probe = await anchor.evaluate(element => {
                    const box = element.getBoundingClientRect();
                    return { text: element.textContent, x: box.x, y: box.y, width: box.width, height: box.height, innerWidth, innerHeight, visible: box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth };
                });
                expect(probe.visible).toBe(true);
                frames.push({ path, theme, size, state, png: { width: pixels.readUInt32BE(16), height: pixels.readUInt32BE(20) }, afterScreenshot: probe });
            }
        }
        await zoom.setZoom(1); await page.setViewportSize({ width: 1440, height: 1000 });
    };
    try {
        await bootstrapUnlockedSession(page, '1234');
        mock.state.holdSettings = true;
        await page.goto('/settings/ai/modelli');
        await expect(page.getByTestId('ai-settings-controls')).toHaveAttribute('disabled', ''); await expect(save).toBeDisabled();
        await expect(page.getByRole('status').filter({ hasText: 'Caricamento delle impostazioni' })).toBeVisible();
        await capture('caricamento'); mock.state.holdSettings = false; mock.releaseSettings();
        await expect(save).toBeEnabled(); await expect(selector('clinical').getByRole('combobox')).toHaveValue(clinical);
        await expect(selector('reasoning').getByRole('combobox')).toHaveValue(reasoning); await capture('modelli');
        const account = page.locator('summary, [data-disclosure-control]').filter({ hasText: /^Account OpenAI · ChatGPT$/u });
        await account.focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('button', { name: 'Collega ChatGPT', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Verifica e attiva locale', exact: true })).toBeEnabled();
        const primaryBackground = await save.evaluate(element => getComputedStyle(element).backgroundColor);
        const primaries = await region.locator('button, a').evaluateAll((elements, background) => elements.filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).backgroundColor === background; }).map(element => element.textContent?.trim()), primaryBackground);
        expect(primaries).toHaveLength(baseline && !causal ? 3 : 1); await capture('account');
        await page.getByRole('button', { name: 'Collega ChatGPT', exact: true }).click();
        const officialLink = page.getByRole('link', { name: 'Apri accesso ufficiale', exact: true }); await expect(officialLink).toBeVisible();
        await expect(officialLink).toHaveAttribute('href', 'https://auth.openai.com/oauth/authorize?state=synthetic-fixture');
        const pendingPrimaries = await region.locator('button, a').evaluateAll((elements, background) => elements.filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).backgroundColor === background; }).map(element => element.textContent?.trim()), primaryBackground);
        expect(pendingPrimaries).toHaveLength(baseline ? 3 : 1);
        await expect(region).toContainText('il tuo consenso sul contenuto esatto da trasmettere a OpenAI');
        await page.getByRole('button', { name: 'Annulla accesso', exact: true }).click(); await expect(page.getByRole('button', { name: 'Collega ChatGPT', exact: true })).toBeVisible(); await account.click();
        mock.state.catalog = 'error';
        for (const id of ['clinical', 'reasoning']) await selector(id).getByRole('button', { name: 'Aggiorna modelli installati', exact: true }).click();
        await expect(selector('clinical').getByRole('status')).toContainText('Impossibile leggere'); await expect(selector('clinical')).not.toContainText('Nessun modello installato'); await capture('errore');
        mock.state.catalog = 'empty';
        for (const id of ['clinical', 'reasoning']) await selector(id).getByRole('button', { name: 'Aggiorna modelli installati', exact: true }).click();
        await expect(selector('clinical').getByRole('status')).toContainText('Nessun modello installato'); await capture('vuoto');
        mock.state.catalog = 'present';
        for (const id of ['clinical', 'reasoning']) await selector(id).getByRole('button', { name: 'Aggiorna modelli installati', exact: true }).click();
        await expect(selector('clinical').getByRole('combobox')).toBeEnabled();
        const presets = page.locator('summary, [data-disclosure-control]').filter({ hasText: /^Configurazioni consigliate$/u }); await presets.focus(); await page.keyboard.press('Enter'); await expect(presets).toBeFocused(); focus.push({ step: 'presets-open', focused: true });
        const high = page.getByRole('button', { name: /Avanzato · oltre 32 GB/u }); await high.focus(); await page.keyboard.press('Space'); await expect(high).toBeFocused(); focus.push({ step: 'preset-draft', focused: true }); await expect(high).toHaveAttribute('aria-pressed', 'true');
        await presets.click(); await presets.click(); await expect(high).toHaveAttribute('aria-pressed', 'true'); await expect(selector('clinical')).toContainText('non è presente nell’elenco');
        expect(mock.writes).toEqual([]); await capture('bozza');
        for (const width of [320, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            if (width === 1440) await zoom.setZoom(4);
            await save.focus(); await page.keyboard.press('Tab');
            await expect(page.getByRole('link', { name: 'Abilita le funzioni cliniche', exact: true })).toBeFocused();
            await page.keyboard.press('Shift+Tab'); await expect(save).toBeFocused();
            expect(mock.writes).toEqual([]); focus.push({ step: 'draft-save-navigation', width, zoom: width === 1440 ? 4 : 1, focused: true });
            await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
        }
        await selector('clinical').getByRole('combobox').selectOption(clinical); await selector('reasoning').getByRole('combobox').selectOption(reasoning);
        mock.state.failSave = true; await save.click(); await expect(page.getByText('Salvataggio non riuscito', { exact: true })).toBeVisible(); expect(mock.writes).toHaveLength(1);
        mock.state.failSave = false; await save.click(); await expect(page.getByText('Configurazione AI salvata', { exact: true })).toBeVisible();
        for (const key of ['aiPatientInsightKillSwitch', 'aiDocumentSynthesisKillSwitch', 'aiSmartImportKillSwitch', 'aiTreatmentReasoningKillSwitch']) expect(mock.config.get(key)).toBe('disabled');
        while (await page.getByRole('button', { name: 'Chiudi notifica', exact: true }).count()) await page.getByRole('button', { name: 'Chiudi notifica', exact: true }).first().click();
        await page.getByRole('button', { name: 'Verifica connessione', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Ollama è raggiungibile:' })).toContainText('2 modelli presenti');
        const activate = page.getByRole('button', { name: 'Verifica e attiva locale', exact: true }); await expect(activate).toBeEnabled(); await activate.click();
        await expect(page.getByText('Stato e funzioni riletti', { exact: true })).toBeVisible(); await expect(region).toContainText('non prova una generazione riuscita né l’idoneità clinica'); await capture('collegamento');
        expect(mock.onboarding()).toMatchObject({ inference: 'not_run', qualification: 'not_assessed' });
        expect(mock.calls.filter(call => call.path === '/api/ai/local-provider/onboarding' && call.method === 'POST')).toHaveLength(1);
        mock.state.settingsFailed = true; await page.reload();
        await expect(page.getByTestId('ai-settings-controls')).toHaveAttribute('disabled', ''); await expect(save).toBeDisabled();
        await expect(region).toContainText('Impossibile leggere le impostazioni.');
        await expect(region).not.toContainText('Nessun modello installato');
        await capture('impostazioni-indisponibili');
        if (directory) await writeFile(`${directory}/receipt.json`, JSON.stringify({ frames, focus, calls: mock.calls, writes: mock.writes, blocked: mock.blocked, errors, finalConfiguration: Object.fromEntries(mock.config), onboarding: mock.onboarding(), providerContacted: false }, null, 2));
        expect(mock.blocked).toEqual([]); expect(errors).toEqual([]);
    } finally { mock.releaseSettings(); await zoom.close(); }
});
