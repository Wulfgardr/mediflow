import { request as http, type APIRequestContext, type Page, type BrowserContext } from '@playwright/test';
import { launchConfinedBrowser } from './browser-network.ts';
import { BrowserInput } from './browser-input.ts';
import { unique } from './unique.ts';
import { CensusToken, type CensusDispatch } from './browser-census.ts';
import { deny, planDigest, portalAttributes, portalContextSchema, type LocalOperationAdapter, type LocalOperationPlan, type AdapterContext, type Destination } from '../contract.ts';

export async function createSyntheticSpecialistBrowser(input: {
    plan(): LocalOperationPlan; cookie: { name: string; value: string; url: string };
    verifyReceipt: LocalOperationAdapter['verifyReceipt'];
}) {
    const origin = input.cookie.url;
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) deny();
    let runtime = await launchConfinedBrowser();
    let context = runtime.context;
    let page = await context.newPage();
    let stopping: Promise<void> = Promise.resolve();
    const transports = new Set<APIRequestContext>();
    let authority: { ctx: AdapterContext; phase: Destination['purpose']; blocked: boolean; census?: CensusDispatch } | null = null;
    async function configure() {
        for (const surface of context.pages()) guardPage(surface);
        context.on('page', surface => { if (authority) authority.blocked = true; guardPage(surface); });
        await context.addCookies([input.cookie]);
        await context.routeWebSocket('**/*', socket => { if (authority) authority.blocked = true; void socket.close(); });
        await context.route('**/*', async route => {
            const active = authority;
            try {
                const request = route.request(), url = new URL(request.url());
                if (!active || request.resourceType() !== 'document' || request.redirectedFrom() || request.frame() !== page.mainFrame()
                    || url.origin !== origin || url.search || url.hash) deny();
                const destination: Destination = { origin: url.origin, path: url.pathname,
                    method: request.method() as Destination['method'], purpose: active.phase };
                active.ctx.authorizeRequest(destination);
                const transport = await http.newContext();
                transports.add(transport);
                try {
                    active.ctx.assertCurrent();
                    if (authority !== active) deny();
                    if (request.method() === 'POST') {
                        if (!active.census) deny();
                        const values = new URLSearchParams(request.postData() ?? '');
                        const expected = input.plan();
                        if ([...values].length !== expected.fields.length || expected.fields.some(field =>
                            unique(values.getAll(field.name)) !== field.value)) deny();
                        active.census.consume();
                        active.ctx.assertCurrent();
                        if (authority !== active || active.blocked) deny();
                    }
                    const response = await transport.fetch(request, { maxRedirects: 0, maxRetries: 0 });
                    active.ctx.assertCurrent();
                    if (response.status() >= 300 && response.status() < 400) deny();
                    await route.fulfill({ response });
                } finally { transports.delete(transport); await transport.dispose(); }
            } catch { if (active) active.blocked = true; await route.abort('blockedbyclient').catch(() => {}); }
        });
    }
    function guardPage(surface: Page) {
        surface.on('dialog', dialog => { if (authority) authority.blocked = true; void dialog.dismiss().catch(() => {}); });
        surface.on('download', download => { if (authority) authority.blocked = true; void download.cancel(); });
        surface.on('worker', () => { if (authority) authority.blocked = true; });
    }
    await configure();
    async function during<T>(ctx: AdapterContext, phase: Destination['purpose'], action: () => Promise<T>): Promise<T> {
        await stopping;
        ctx.assertCurrent();
        if (!runtime.browser.isConnected()) { runtime = await launchConfinedBrowser(); context = runtime.context; await configure(); }
        if (page.isClosed()) { page = await context.newPage(); }
        const active = { ctx, phase, blocked: false }; authority = active;
        try { const value = await action(); ctx.assertCurrent(); if (active.blocked) deny(); return value; }
        catch (error) { await page.close().catch(() => {}); throw error; }
        finally { authority = null; }
    }
    async function submit(ctx: AdapterContext, phase: 'prepare' | 'act', button: string) {
        return during(ctx, phase, async () => {
            const token = await CensusToken.capture(context, page);
            try {
                const observation = await inspectPage(token);
                if (observation.unclassifiedFields.length || observation.planDigest !== planDigest(input.plan())) deny();
                token.bind(ctx.snapshot(observation), () => ctx.snapshot(inspectPage(token)));
                const command = unique(token.census.status === 'complete' ? token.census.controls.filter(control => control.tag === 'BUTTON' && control.text === button) : []);
                const selector = command.action ? `button[formaction=${JSON.stringify(command.action)}]` : 'button:not([formaction])';
                const inputEvents = await BrowserInput.observe(context, page);
                await inputEvents.command('focus', selector);
                return await token.act(async census => {
                    if (!authority) deny();
                    authority.census = census;
                    await Promise.all([page.waitForURL(url => url.pathname === (phase === 'prepare' ? '/draft' : '/submit')), inputEvents.command('click', selector)]);
                    if (phase === 'act') return JSON.parse(await inputEvents.readBody()) as unknown;
                });
            } catch (error) { await page.close().catch(() => {}); throw error; }
            finally { await token.close(); }
        });
    }
    function inspectPage(token: CensusToken) {
        const expected = input.plan();
        const census = token.census;
        if (census.status !== 'complete') deny();
        const controls = census.controls;
        const fields = controls.filter(control => control.tag !== 'BUTTON');
        const buttons = controls.filter(control => control.tag === 'BUTTON');
        const unknown = [...census.unexpected, ...fields.filter(field => field.tag !== 'INPUT' || field.type !== 'text' || field.editable || !field.placed
            || !expected.fields.some(item => item.name === field.name)).map(field => field.name || 'unnamed-control')];
        const expectedButtons = [{ text: 'Salva bozza', action: null }, { text: 'Emetti prescrizione', action: '/submit' }, { text: 'Invia e firma come medico', action: '/physician-submit' }];
        const complete = fields.length === expected.fields.length && new Set(fields.map(field => field.name)).size === fields.length
            && buttons.length === expectedButtons.length && expectedButtons.every(expected => {
                const button = unique(buttons.filter(button => button.text === expected.text));
                return button.placed && !button.editable && button.type === 'submit' && !button.name && expected.action === button.action;
            });
        const readback = { ...expected, fields: expected.fields.map(field => ({ ...field, value: unique(fields.filter(item => item.name === field.name)).value })) };
        return { ...portalContextSchema.parse(Object.fromEntries(Object.entries(portalAttributes).map(([key, attr]) => [key, census.metadata[attr]]))),
            humanRevision: Number(census.metadata['data-human']), census: census.status, unclassifiedFields: complete ? unknown : [...unknown, 'invalid-field-set'],
            planDigest: fields.every(field => field.value) && complete ? planDigest(readback) : null };
    }
    const adapter: LocalOperationAdapter = {
        version: 'synthetic-prreg-browser-1', protectedFinalAct: true,
        async observe(ctx) {
            return during(ctx, 'observe', async () => {
                await page.goto(`${origin}/portal`, { waitUntil: 'load' });
                const token = await CensusToken.capture(context, page);
                try { return await inspectPage(token); } finally { await token.close(); }
            });
        },
        async prepare(ctx, plan) {
            for (const field of plan.fields) { ctx.assertCurrent(); await (await BrowserInput.observe(context, page)).command('fill', `input[name=${JSON.stringify(field.name)}]`, field.value); }
            await submit(ctx, 'prepare', 'Salva bozza');
        },
        act: ctx => submit(ctx, 'act', 'Emetti prescrizione'),
        reconcile: ctx => during(ctx, 'reconcile', async () => {
            const response = await page.goto(`${origin}/receipt`, { waitUntil: 'load' });
            if (!response || response.status() !== 200) deny(); return response.json();
        }),
        verifyReceipt: input.verifyReceipt,
        stop() {
            authority = null;
            stopping = Promise.allSettled([runtime.close(), ...[...transports].map(transport => transport.dispose())]).then(() => {});
        },
    };
    return Object.freeze({ adapter, get page() { return page; }, get context() { return context; },
        async close() { adapter.stop(); await stopping; await runtime.close(); },
    });
}

export async function physicianSubmit(page: Page, context: BrowserContext, input: {
    origin: string; cookie: { name: string; value: string; url: string };
}) {
    await context.addCookies([input.cookie]);
    await page.goto(`${input.origin}/portal`);
    await Promise.all([page.waitForURL(`${input.origin}/physician-submit`), page.getByRole('button', { name: 'Invia e firma come medico' }).click()]);
}
