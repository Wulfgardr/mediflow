import { expect, test } from '@playwright/test';
import fs from 'node:fs';

const html = fs.readFileSync('lib/chat-card/native-access.html', 'utf8');

test.beforeEach(async ({ page, context }) => {
    await context.route(url => url.port === '3000', route => route.abort('blockedbyclient'));
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.evaluate(source => {
        const state = { status: 'challenge', attached: false, calls: [] as unknown[] };
        (window as unknown as { accessFixture: typeof state }).accessFixture = state;
        window.addEventListener('message', event => {
            const request = event.data;
            if (!request?.id) return;
            let result: unknown = {};
            if (request.method === 'ui/initialize') result = { protocolVersion: '2026-01-26', hostCapabilities: { serverTools: {} } };
            else if (request.method === 'tools/call') {
                state.calls.push(request.params);
                const command = request.params.arguments.command;
                let status = state.status;
                let payload: string | undefined;
                if (command === 'attach') { status = state.attached ? 'withdrawn' : 'ready'; state.attached = true; }
                if (command === 'consume') { status = state.status = 'consumed'; payload = JSON.stringify({ profile: 'mediflow.synthetic-chat-card.v1', pseudonym: 'card_' + 'a'.repeat(32), history: [], therapies: [], measures: [] }); }
                if (command === 'revoke') status = state.status = 'withdrawn';
                result = { content: [{ type: 'text', text: 'Esito disponibile nella vista.' }], _meta: { status, ...(payload ? { payload } : {}) } };
            }
            (event.source as Window).postMessage({ jsonrpc: '2.0', id: request.id, result }, '*');
        });
        const frame = document.createElement('iframe'); frame.id = 'access'; frame.sandbox.add('allow-scripts');
        frame.style.width = '100%'; frame.style.height = '600px'; frame.srcdoc = source;
        document.body.append(frame);
    }, html);
});

test('the static frame sends only closed status commands and consumes once', async ({ page }) => {
    const frame = page.frameLocator('#access');
    await frame.getByRole('button', { name: 'Richiedi accesso' }).click();
    await expect(frame.getByRole('status')).toContainText('Conferma nella finestra MediFlow');
    await page.evaluate(() => { (window as unknown as { accessFixture: { status: string } }).accessFixture.status = 'approved'; });
    await frame.getByRole('button', { name: 'Mostra scheda monouso' }).click();
    await expect(frame.getByRole('status')).toContainText('consumata');
    await expect(frame.getByRole('button', { name: 'Mostra scheda monouso' })).toBeDisabled();
    const calls = await page.evaluate(() => (window as unknown as { accessFixture: { calls: Record<string, unknown>[] } }).accessFixture.calls);
    for (const call of calls) {
        expect(call.name).toBe('mediflow_native_access');
        expect(Object.keys(call).sort()).toEqual(['arguments', 'name']);
        expect(Object.keys(call.arguments as object)).toEqual(['command']);
    }
});

test('reloading the frame retires its association instead of recovering a grant', async ({ page }) => {
    const frame = page.frameLocator('#access');
    await frame.getByRole('button', { name: 'Richiedi accesso' }).click();
    await expect(frame.getByRole('status')).toContainText('Conferma nella finestra MediFlow');
    await page.locator('#access').evaluate(element => { const frame = element as HTMLIFrameElement; frame.srcdoc = frame.srcdoc; });
    await expect(frame.getByRole('status')).toContainText('Accesso ritirato');
    await expect(frame.getByRole('button', { name: 'Richiedi accesso' })).toBeDisabled();
});

for (const scenario of ['native-revoke', 'new-turn', 'teardown', 'idle']) test(`displayed pseudonyms are withdrawn on ${scenario}`, async ({ page }) => {
    await page.clock.install();
    const frame = page.frameLocator('#access');
    await frame.getByRole('button', { name: 'Richiedi accesso' }).click();
    await page.evaluate(() => { (window as unknown as { accessFixture: { status: string } }).accessFixture.status = 'approved'; });
    await page.clock.runFor(1000);
    await frame.getByRole('button', { name: 'Mostra scheda monouso' }).click();
    await expect(frame.getByRole('region', { name: 'Scheda sintetica' })).toBeVisible();
    if (scenario === 'native-revoke') {
        await page.evaluate(() => { (window as unknown as { accessFixture: { status: string } }).accessFixture.status = 'withdrawn'; });
        await page.clock.runFor(1000);
    } else if (scenario === 'idle') await page.clock.runFor(300001);
    else await page.evaluate(method => {
        const target = (document.querySelector('#access') as HTMLIFrameElement).contentWindow!;
        target.postMessage({ jsonrpc: '2.0', id: 900, method }, '*');
    }, scenario === 'new-turn' ? 'ui/notifications/tool-input' : 'ui/resource-teardown');
    await expect(frame.getByRole('region', { name: 'Scheda sintetica' })).toBeHidden();
    await expect(frame.getByRole('button', { name: 'Mostra scheda monouso' })).toBeDisabled();
});

test('the initial tool-input notification does not revoke a view before the user starts', async ({ page }) => {
    await expect(page.frameLocator('#access').getByRole('button', { name: 'Richiedi accesso' })).toBeEnabled();
    await page.evaluate(() => (document.querySelector('#access') as HTMLIFrameElement).contentWindow!.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: {} } }, '*'));
    await expect(page.frameLocator('#access').getByRole('button', { name: 'Richiedi accesso' })).toBeEnabled();
});
