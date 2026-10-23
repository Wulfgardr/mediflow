/* Test-only same-response oracle. No production import, extra fetch, clone, tee,
 * body replacement or CDP getResponseBody. The application remains the sole reader.
 * Chromium can report ERR_ABORTED after natural EOF for no-store streams:
 * https://github.com/microsoft/playwright/issues/42742
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Page, Request as BrowserRequest, Response as BrowserResponse, Frame } from '@playwright/test';

import { installSameResponseCapture, type Capture, type CaptureGlobal } from './browser-response-stream.ts';
export { installSameResponseCapture } from './browser-response-stream.ts';
type Operation = 'consent' | 'login/complete';

export function parseCapturedResponse(capture: Capture, expected: { id: string; url: string; status: number; cacheControl: string | undefined; contentType: string | undefined }): unknown {
    assert.equal(capture.id, expected.id, 'ORACLE_TICKET_MISMATCH');
    assert.equal(capture.url, expected.url, 'ORACLE_URL_MISMATCH');
    assert.equal(capture.status, expected.status, 'ORACLE_STATUS_MISMATCH');
    assert.equal(capture.cacheControl, expected.cacheControl ?? null, 'ORACLE_HEADER_MISMATCH');
    assert.equal(capture.contentType, expected.contentType ?? null, 'ORACLE_HEADER_MISMATCH');
    assert.equal(capture.cacheControl, 'no-store', 'ORACLE_NO_STORE_REQUIRED');
    assert.match(capture.contentType ?? '', /^application\/json(?:\s*;|$)/i, 'ORACLE_JSON_REQUIRED');
    assert.ok(Array.isArray(capture.bytes) && capture.bytes.length > 0 && capture.bytes.length <= 262144
        && capture.bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255), 'ORACLE_BYTES_INVALID');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(capture.bytes)));
}

export type SameResponseTicket = { response: Promise<BrowserResponse>; json(): Promise<unknown> };
export type BrowserResponseOracle = Awaited<ReturnType<typeof createBrowserResponseOracle>>;
export async function createBrowserResponseOracle(page: Page, base: string) {
    const namespace = '/api/settings/ai/chatgpt/synthesis/';
    await page.addInitScript(installSameResponseCapture, { base, namespace });
    let active = false;
    const disposers = new Set<() => void>();
    async function arm(operation: Operation): Promise<SameResponseTicket> {
        assert.equal(active, false, 'ORACLE_TICKET_ALREADY_ACTIVE'); active = true;
        const id = randomUUID(), url = base + namespace + operation;
        let request: BrowserRequest | undefined, responseValue: BrowserResponse | undefined;
        let networkTerminal: 'pending' | 'finished' | 'failed' = 'pending';
        let settleResponse!: (response: BrowserResponse) => void, settleFinished!: () => void, reject!: (error: Error) => void;
        const response = new Promise<BrowserResponse>(resolve => { settleResponse = resolve; });
        const finished = new Promise<void>(resolve => { settleFinished = resolve; });
        const failure = new Promise<never>((_, fail) => { reject = fail; });
        // The same rejection is raced by response/json. Mark it handled during the
        // user's click without converting it into a success or changing its cause.
        void failure.catch(() => {});
        const fail = (code: string) => {
            // Snapshot Node observations at this failure, not a reader phase or
            // an abort initiator. The plain message also survives CI reporting.
            const context = Object.freeze({ operation, requestSelected: request !== undefined,
                responseStatus: responseValue?.status() ?? null, networkTerminal });
            const error = new Error(`${code} [operation=${context.operation}; responseStatus=${context.responseStatus ?? 'not-observed'}; requestSelected=${context.requestSelected}; networkTerminal=${context.networkTerminal}]`);
            Object.defineProperty(error, 'oracleContext', { value: context, enumerable: true });
            reject(error);
        };
        const onRequest = (value: BrowserRequest) => {
            if (value.url() !== url || value.method() !== 'POST') return;
            if (request) { fail('ORACLE_DUPLICATE_BROWSER_REQUEST'); return; }
            request = value;
            if (value.frame() !== page.mainFrame() || value.isNavigationRequest() || value.redirectedFrom()) fail('ORACLE_BROWSER_REQUEST_IDENTITY');
        };
        const onResponse = (value: BrowserResponse) => {
            if (value.request() !== request) return;
            if (responseValue || value.fromServiceWorker() || value.url() !== url) { fail('ORACLE_BROWSER_RESPONSE_IDENTITY'); return; }
            responseValue = value; settleResponse(value);
        };
        const onFinished = (value: BrowserRequest) => { if (value === request) { networkTerminal = 'finished'; settleFinished(); } };
        const onFailed = (value: BrowserRequest) => {
            if (value !== request) return;
            networkTerminal = 'failed';
            if (value.failure()?.errorText === 'net::ERR_ABORTED' && responseValue?.headers()['cache-control'] === 'no-store') settleFinished();
            else fail(`ORACLE_NETWORK_FAILED: ${value.failure()?.errorText ?? 'unknown'}`);
        };
        const onClose = () => fail('ORACLE_PAGE_CLOSED');
        const onCrash = () => fail('ORACLE_PAGE_CRASHED');
        const onNavigation = (frame: Frame) => { if (frame === page.mainFrame()) fail('ORACLE_DOCUMENT_CHANGED'); };
        page.on('request', onRequest); page.on('response', onResponse); page.on('requestfinished', onFinished); page.on('requestfailed', onFailed);
        page.on('close', onClose); page.on('crash', onCrash); page.on('framenavigated', onNavigation);
        const timer = setTimeout(() => fail('ORACLE_COMPLETION_DEADLINE'), 25000);
        function dispose() {
            clearTimeout(timer);
            page.off('request', onRequest); page.off('response', onResponse); page.off('requestfinished', onFinished); page.off('requestfailed', onFailed);
            page.off('close', onClose); page.off('crash', onCrash); page.off('framenavigated', onNavigation);
            active = false; disposers.delete(dispose);
        }
        disposers.add(dispose);
        try { await Promise.race([page.evaluate(({ id, operation }) => {
            const api = (globalThis as CaptureGlobal).__mfSameResponse;
            if (!api) throw new Error('ORACLE_NOT_INSTALLED'); api.arm(id, operation);
        }, { id, operation }), failure]); } catch (error) { dispose(); throw error; }
        const guardedResponse = Promise.race([response, failure]);
        void guardedResponse.catch(() => {});
        let read = false;
        return {
            response: guardedResponse,
            async json() {
                assert.equal(read, false, 'ORACLE_TICKET_ALREADY_READ'); read = true;
                try {
                    const received = await guardedResponse;
                    assert.equal(received.status(), operation === 'consent' ? 200 : 409, 'ORACLE_UNEXPECTED_STATUS');
                    await Promise.race([finished, failure]);
                    const capture = await Promise.race([page.evaluate(id => {
                        const api = (globalThis as CaptureGlobal).__mfSameResponse;
                        if (!api) throw new Error('ORACLE_NOT_INSTALLED'); return api.take(id);
                    }, id), failure]);
                    assert.strictEqual(received.request(), request, 'ORACLE_BROWSER_REQUEST_MISMATCH');
                    const headers = received.headers();
                    return parseCapturedResponse(capture, { id, url, status: received.status(), cacheControl: headers['cache-control'], contentType: headers['content-type'] });
                } finally { dispose(); }
            },
        };
    }
    return { arm, async check() {
        assert.equal(active, false, 'ORACLE_TICKET_UNFINISHED');
        await page.evaluate(() => {
            const api = (globalThis as CaptureGlobal).__mfSameResponse;
            if (!api) throw new Error('ORACLE_NOT_INSTALLED'); api.check();
        });
    }, dispose() { for (const dispose of [...disposers]) dispose(); } };
}
