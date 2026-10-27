import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { emptyReceipt, type ProductSnapshot } from '../lib/chatgpt-product/product-contract';
import { bootstrapUnlockedSession, assertNoHorizontalOverflow } from './utils';
import { installFunctionsEgressGuard } from './fixtures/settings-functions';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';

const accountTitle = 'Controllo account ChatGPT · separato dalla prova';
const baseline = process.env.CHATGPT_COMPOSITION_BASELINE === '1';
const snapshot: ProductSnapshot = {
    schema: 'mediflow.chatgpt-product.v1', state: 'held', notice: null,
    preparation: { state: 'not_prepared', expiresAt: null },
    contextRevision: '11111111-1111-4111-8111-111111111111',
    qualification: { platform: 'synthetic-only', state: 'unqualified', revision: 'composition-v1', missing: ['synthetic-boundary'] },
    disclosure: { revision: '22222222-2222-4222-8222-222222222222', operation: 'synthetic_synthesis',
        dataClass: 'synthetic_fixture', fixtureId: 'composition-only', inputSha256: 'a'.repeat(64),
        sources: [{ id: 'S1', title: 'Fonte dimostrativa', text: 'Contenuto interamente sintetico.', sha256: 'b'.repeat(64) }],
        egress: ['auth.openai.com:443', 'chatgpt.com:443'], maximumDurationMs: 300000, proposalOnly: true, clinicalWrites: 0 },
    authenticatedProcess: 'none', accountControlAdmitsExecution: false, plan: null,
    consentExpiresAt: null, loginExpiresAt: null, catalog: null, limits: null, result: null,
    receipt: emptyReceipt(), clinicalAdmission: 'held', manualGenerationOnly: true,
};

async function capture(page: Page, target: Locator, name: string, frames: unknown[]) {
    const directory = process.env.CHATGPT_COMPOSITION_SCREENSHOTS;
    if (!directory) throw Error('Owned capture directory required');
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeVisible();
    const probe = await target.evaluate(element => {
        const r = element.getBoundingClientRect(), inset = Math.min(8, r.width / 4, r.height / 4);
        const points = [[r.x + r.width / 2, r.y + r.height / 2], [r.x + inset, r.y + inset],
            [r.right - inset, r.y + inset], [r.x + inset, r.bottom - inset], [r.right - inset, r.bottom - inset]]
            .map(([x, y]) => { const hit = document.elementFromPoint(x, y); return { x, y, hit: hit === element || !!hit && element.contains(hit) }; });
        const scrollOwners = [];
        for (let p = element.parentElement; p; p = p.parentElement)
            if (p.scrollHeight > p.clientHeight && /auto|scroll/u.test(getComputedStyle(p).overflowY))
                scrollOwners.push({ tag: p.tagName, className: p.className, scrollTop: p.scrollTop });
        return { rect: { x: r.x, y: r.y, right: r.right, bottom: r.bottom }, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
            points, scrollOwners, text: element.textContent?.trim().slice(0, 500) };
    });
    await mkdir(directory, { recursive: true });
    const path = `${directory}/${name}.png`;
    await page.screenshot({ path, fullPage: false });
    frames.push({ name, path, ...probe });
    await writeFile(`${directory}/manifest.json`, JSON.stringify(frames, null, 2));
    expect(probe.rect.x, name).toBeGreaterThanOrEqual(-1);
    expect(probe.rect.y, name).toBeGreaterThanOrEqual(-1);
    expect(probe.rect.right, name).toBeLessThanOrEqual(probe.viewport.width + 1);
    expect(probe.rect.bottom, name).toBeLessThanOrEqual(probe.viewport.height + 1);
    expect(probe.points.every(point => point.hit), `${name}: center and inset corners`).toBe(true);
}

test('ChatGPT composition: closed/open account, keyboard and retained child', async ({ baseURL }) => {
    test.setTimeout(120_000);
    if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).port === '3000'
        || process.env.MF085_SYNTHETIC_E2E !== '1' || !process.env.MEDIFLOW_DATA_DIR) throw Error('Owned synthetic loopback required');
    const zoom = await openBrowserZoomFixture(baseURL), page = zoom.page;
    const guard = await installFunctionsEgressGuard(page, baseURL);
    const calls: { path: string; method: string }[] = [], frames: unknown[] = [], errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/settings/ai/chatgpt/**', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
        if (url.origin !== new URL(baseURL).origin) return route.fallback();
        calls.push({ path, method });
        if (path === '/api/settings/ai/chatgpt/synthesis/status' && method === 'GET') return route.fulfill({ json: { snapshot } });
        if (path === '/api/settings/ai/chatgpt/status' && method === 'GET') return route.fulfill({ json: {
            state: 'disconnected', notice: null, plan: null, loginExpiresAt: null, actions: ['connect'],
            inferenceEnabled: false, executionBlock: 'data_boundary_unqualified',
        } });
        if (path === '/api/settings/ai/chatgpt/synthesis/cancel' && method === 'POST' && request.postData() === '{}')
            return route.fulfill({ json: { snapshot: { ...snapshot, state: 'canceled' } } });
        return route.fallback();
    });
    try {
        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        await page.goto('/settings/ai/chatgpt');
        await expect(page.getByTestId('synthesis-state')).toContainText('Prova sospesa');
        const control = baseline ? page.locator('summary').filter({ hasText: accountTitle }) : page.getByRole('button', { name: accountTitle, exact: true });
        const account = page.getByTestId('chatgpt-account-panel');
        await expect(account).toHaveCount(1);
        await expect(account).toBeHidden();
        await expect.poll(() => calls.some(call => call.path === '/api/settings/ai/chatgpt/status')).toBe(true);
        if (!baseline) {
            await expect(page.locator('h1')).toHaveCount(1);
            await expect(page.getByRole('heading', { name: 'OpenAI · ChatGPT', exact: true, level: 2 })).toBeVisible();
        }
        const child = await account.elementHandle();
        if (!child) throw Error('Mounted account required');
        for (const theme of ['giorno', 'grafite']) for (const size of [1440, 768, 390, 320, 'zoom-200', 'zoom-400'] as const) {
            await page.setViewportSize({ width: 1440, height: 1000 });
            await zoom.setZoom(size === 'zoom-200' ? 2 : size === 'zoom-400' ? 4 : 1);
            if (typeof size === 'number') await page.setViewportSize({ width: size, height: 1000 });
            await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'grafite'); document.documentElement.dataset.theme = theme; }, theme);
            if (baseline && process.env.CHATGPT_COMPOSITION_COMPLETE === '1' && theme === 'giorno' && size === 1440) {
                await assertNoHorizontalOverflow(page, [{ label: 'document', selector: 'document' },
                    { label: 'ChatGPT page', selector: '[data-testid="chatgpt-synthesis-panel"]' }]);
                continue;
            }
            await capture(page, page.getByRole('heading', { name: /^OpenAI · ChatGPT\.?$/u }), `${theme}-${size}-title`, frames);
            await capture(page, control, `${theme}-${size}-closed`, frames);
            await control.focus(); await page.keyboard.press('Enter');
            await expect(account).toBeVisible(); await expect(control).toBeFocused();
            const assistance = account.locator('summary').filter({ hasText: 'Dettagli per l’assistenza' });
            await assistance.evaluate(element => { (element.parentElement as HTMLDetailsElement).open = true; });
            await capture(page, account.getByTestId('chatgpt-account-state'), `${theme}-${size}-open-status`, frames);
            await capture(page, account.getByRole('button', { name: 'Rileggi stato', exact: true }), `${theme}-${size}-open-action`, frames);
            await control.focus(); await page.keyboard.press('Space');
            await expect(account).toBeHidden(); await expect(control).toBeFocused();
            await control.press('Enter');
            await expect(account).toBeVisible();
            expect(await child.evaluate(element => element === document.querySelector('[data-testid="chatgpt-account-panel"]'))).toBe(true);
            await expect(assistance.locator('..')).toHaveAttribute('open', '');
            await control.press('Space');
            await expect(account).toBeHidden();
            await assertNoHorizontalOverflow(page, [{ label: 'document', selector: 'document' },
                { label: 'ChatGPT page', selector: '[data-testid="chatgpt-synthesis-panel"]' }]);
        }
        await page.goto('/settings');
        expect(guard.blocked).toEqual([]); expect(errors).toEqual([]);
        expect(calls.filter(call => call.method !== 'GET').every(call => call.path.endsWith('/synthesis/cancel'))).toBe(true);
    } finally {
        const directory = process.env.CHATGPT_COMPOSITION_SCREENSHOTS;
        if (directory) { await mkdir(directory, { recursive: true }); await writeFile(`${directory}/calls.json`, JSON.stringify({ calls, blocked: guard.blocked, uiWrites: guard.mockedUiWrites, errors }, null, 2)); }
        await zoom.close();
    }
});
