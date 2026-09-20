/* Synthetic oracle conformance, inside the EXISTING browser acceptance command.
 * This tiny HTTP server is not a replacement for the real Card/root scenarios.
 */
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createServer } from 'node:http';
import type { Browser } from '@playwright/test';
import { createBrowserResponseOracle } from './chatgpt-browser-response.ts';

export async function checkBrowserResponseContract(browser: Browser, t: TestContext) {
    const namespace = '/api/settings/ai/chatgpt/synthesis/';
    const bounded = async (work: Promise<unknown>, name: string) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([work, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`ORACLE_CONTRACT_CLEANUP_TIMEOUT: ${name}`)), 10000);
        })]); } finally { clearTimeout(timer); }
    };
    const cases = ['valid', 'pending-409', 'malformed', 'invalid-utf8', 'truncated-valid-json', 'wrong-status', 'missing-no-store', 'abort', 'cancel-before-eof', 'duplicate'] as const;
    for (const mode of cases) await t.test(`same browser response oracle: ${mode}`, { timeout: 35000 }, async t => {
        let requests = 0;
        const bytes = Buffer.from('{"snapshot":{"state":"consented","clinicalAdmission":"held"},"unicode":"è 🩺"}');
        const server = createServer((input, output) => {
            if (input.url === '/' && input.method === 'GET') {
                output.writeHead(200, { 'Content-Type': 'text/html' }); output.end('<!doctype html><title>Oracle contract</title><link rel="icon" href="data:,">'); return;
            }
            if (input.method !== 'POST' || ![namespace + 'consent', namespace + 'login/complete'].includes(input.url ?? '')) { output.writeHead(404); output.end(); return; }
            requests++; input.resume();
            input.once('end', () => {
                const body = mode === 'malformed' ? Buffer.from('{"snapshot":') : mode === 'invalid-utf8' ? Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])
                    : mode === 'pending-409' ? Buffer.from('{"error":"login_pending","clinicalAdmission":"held"}') : bytes;
                output.writeHead(mode === 'wrong-status' ? 401 : mode === 'pending-409' ? 409 : 200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    ...(mode === 'missing-no-store' ? {} : { 'Cache-Control': 'no-store' }),
                    'Content-Length': body.byteLength + (['truncated-valid-json', 'abort', 'cancel-before-eof'].includes(mode) ? 8 : 0), 'Connection': 'close',
                });
                // Even syntactically valid JSON must fail when HTTP framing is incomplete.
                if (mode === 'abort' || mode === 'cancel-before-eof') {
                    // Keep the real body open until the explicit client fault.
                    // No timer/sleep creates the ordering; context cleanup owns the socket.
                    output.flushHeaders(); output.write(body);
                } else output.end(body);
            });
        });
        server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxConnections = 8;
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        t.after(async () => { server.closeAllConnections(); await bounded(new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())), 'http'); });
        const address = server.address(); assert.ok(address && typeof address === 'object');
        const base = `http://127.0.0.1:${address.port}`;
        const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
        t.after(async () => { await bounded(context.close(), 'context'); });
        const unexpected: string[] = [];
        await context.route(url => url.origin !== base, async route => { unexpected.push('external'); await route.abort(); });
        await context.routeWebSocket('**/*', route => { unexpected.push('websocket'); route.close(); });
        const page = await context.newPage();
        const oracle = await createBrowserResponseOracle(page, base); t.after(() => oracle.dispose());
        await page.goto(base);
        const operation = mode === 'pending-409' ? 'login/complete' : 'consent';
        const ticket = await oracle.arm(operation);
        // An explicit synthetic consumer, not a mocked response or native method.
        const consumer = page.evaluate(async ({ mode, path }) => {
            const controller = new AbortController();
            try {
                const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal });
                if (mode === 'duplicate') await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                const reader = response.body!.getReader();
                if (mode === 'cancel-before-eof') await reader.cancel();
                try {
                    for (;;) {
                        const part = await reader.read(); if (part.done) break;
                        if (mode === 'abort') controller.abort();
                    }
                } finally { await reader.cancel(); }
                return 'consumed';
            } catch { return 'consumer-rejected'; } // This fault-injection result is asserted independently below.
        }, { mode, path: namespace + operation });
        void consumer.catch(() => {}); // Preserve rejection for the explicit await if the page dies.
        if (mode === 'valid' || mode === 'pending-409') {
            assert.deepEqual(await ticket.json(), mode === 'valid' ? JSON.parse(bytes.toString('utf8')) : { error: 'login_pending', clinicalAdmission: 'held' });
            assert.equal(await consumer, 'consumed'); await oracle.check();
        } else {
            const reason = { malformed: /JSON|position|end|property/i, 'invalid-utf8': /encoded data|encoding/i,
                'truncated-valid-json': /ORACLE_NETWORK_FAILED|ORACLE_READ_REJECTED/,
                'wrong-status': /ORACLE_UNEXPECTED_STATUS/, 'missing-no-store': /ORACLE_NO_STORE_REQUIRED/,
                abort: /ORACLE_SIGNAL_ABORTED|ORACLE_NETWORK_FAILED/, 'cancel-before-eof': /ORACLE_CANCEL_BEFORE_EOF|ORACLE_NETWORK_FAILED/,
                duplicate: /ORACLE_DUPLICATE/ }[mode];
            await assert.rejects(ticket.json(), reason);
            const consumption = await consumer;
            if (mode === 'abort' || mode === 'truncated-valid-json') assert.equal(consumption, 'consumer-rejected');
        }
        assert.equal(requests, mode === 'duplicate' ? 2 : 1); assert.deepEqual(unexpected, []);
    });
}
