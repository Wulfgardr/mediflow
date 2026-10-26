import { expect, test } from '@playwright/test';
import fs from 'node:fs';

const html = fs.readFileSync('lib/chat-card/native-access.html', 'utf8');

test.beforeEach(async ({ page }) => {
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
                if (command === 'attach') { status = state.attached ? 'withdrawn' : 'ready'; state.attached = true; }
                if (command === 'consume') status = state.status = 'consumed';
                if (command === 'revoke') status = state.status = 'withdrawn';
                result = { content: [{ type: 'text', text: 'Esito disponibile nella vista.' }], _meta: { status } };
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
    await frame.getByRole('button', { name: 'Verifica accesso monouso' }).click();
    await expect(frame.getByRole('status')).toContainText('consumato');
    await expect(frame.getByRole('button', { name: 'Verifica accesso monouso' })).toBeDisabled();
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
