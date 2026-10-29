import { chromium, type Page, type BrowserContext } from '@playwright/test';
import { deny, planDigest, type LocalOperationAdapter, type LocalOperationPlan, type AdapterContext, type Destination } from '../contract.ts';

export async function createSyntheticSpecialistBrowser(input: {
    plan(): LocalOperationPlan; cookie: { name: string; value: string; url: string };
    verifyReceipt: LocalOperationAdapter['verifyReceipt'];
}) {
    const origin = input.cookie.url;
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) deny();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await context.addCookies([input.cookie]);
    let page = await context.newPage();
    let authority: { ctx: AdapterContext; phase: Destination['purpose']; blocked: boolean } | null = null;
    await context.route('**/*', async route => {
        const active = authority;
        try {
            const request = route.request(), url = new URL(request.url());
            if (!active || request.redirectedFrom() || request.frame() !== page.mainFrame()
                || url.origin !== origin || url.search || url.hash) deny();
            const destination: Destination = { origin: url.origin, path: url.pathname,
                method: request.method() as Destination['method'], purpose: active.phase };
            active.ctx.authorizeRequest(destination);
            const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
            active.ctx.assertCurrent();
            if (response.status() >= 300 && response.status() < 400) deny();
            await route.fulfill({ response });
        } catch { if (active) active.blocked = true; await route.abort('blockedbyclient').catch(() => {}); }
    });
    function guardPage() {
        page.on('popup', popup => { void popup.close(); });
        page.on('dialog', dialog => { void dialog.dismiss(); });
        page.on('download', download => { void download.cancel(); });
    }
    guardPage();
    async function during<T>(ctx: AdapterContext, phase: Destination['purpose'], action: () => Promise<T>): Promise<T> {
        ctx.assertCurrent(); const active = { ctx, phase, blocked: false }; authority = active;
        try { const value = await action(); ctx.assertCurrent(); if (active.blocked) deny(); return value; }
        catch (error) { await page.close(); page = await context.newPage(); guardPage(); throw error; }
        finally { authority = null; }
    }
    async function submit(ctx: AdapterContext, phase: 'prepare' | 'act', button: string) {
        return during(ctx, phase, async () => {
            await Promise.all([page.waitForURL(url => url.pathname === (phase === 'prepare' ? '/draft' : '/submit')), page.getByRole('button', { name: button, exact: true }).click()]);
            if (phase === 'act') return JSON.parse(await page.locator('body').innerText()) as unknown;
        });
    }
    const adapter: LocalOperationAdapter = {
        version: 'synthetic-prreg-browser-1', protectedFinalAct: true,
        async observe(ctx) {
            return during(ctx, 'observe', async () => {
                await page.goto(`${origin}/portal`, { waitUntil: 'load' });
                const expected = input.plan(), main = page.locator('main');
                const fields = await page.locator('input').evaluateAll<{ name: string; value: string }[], HTMLInputElement>(inputs => inputs.map(input => ({ name: input.name, value: input.value })));
                const unknown = fields.filter(field => !expected.fields.some(item => item.name === field.name)).map(field => field.name);
                const complete = fields.length === expected.fields.length && new Set(fields.map(field => field.name)).size === fields.length;
                const readback = { ...expected, fields: expected.fields.map(field => ({ ...field, value: fields.find(item => item.name === field.name)?.value ?? '' })) };
                return { patientId: await main.getAttribute('data-patient') ?? '', practiceId: await main.getAttribute('data-practice') ?? '',
                    portalAccountId: await main.getAttribute('data-account') ?? '', uiVersion: await main.getAttribute('data-ui') ?? '',
                    humanRevision: Number(await main.getAttribute('data-human')), unclassifiedFields: complete ? unknown : [...unknown, 'invalid-field-set'],
                    planDigest: fields.every(field => field.value) && complete ? planDigest(readback) : null };
            });
        },
        async prepare(ctx, plan) {
            for (const field of plan.fields) { ctx.assertCurrent(); await page.locator(`input[name=${JSON.stringify(field.name)}]`).fill(field.value); }
            await submit(ctx, 'prepare', 'Salva bozza');
        },
        act: ctx => submit(ctx, 'act', 'Emetti prescrizione'),
        reconcile: ctx => during(ctx, 'reconcile', async () => {
            const response = await page.goto(`${origin}/receipt`, { waitUntil: 'load' });
            if (!response || response.status() !== 200) deny(); return response.json();
        }),
        verifyReceipt: input.verifyReceipt,
        stop() { authority = null; },
    };
    return Object.freeze({ adapter, get page() { return page; }, context,
        async close() { adapter.stop(); await browser.close(); },
    });
}

export async function physicianSubmit(page: Page, context: BrowserContext, input: {
    origin: string; cookie: { name: string; value: string; url: string };
}) {
    await context.addCookies([input.cookie]);
    await page.goto(`${input.origin}/portal`);
    await Promise.all([page.waitForURL(`${input.origin}/physician-submit`), page.getByRole('button', { name: 'Invia e firma come medico' }).click()]);
}
