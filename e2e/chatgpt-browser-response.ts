/* Test-only same-response oracle. No production import, extra fetch, clone, tee,
 * body replacement or CDP getResponseBody. The application remains the sole reader.
 * Success requires BOTH natural renderer EOF and the matching requestfinished.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Page, Request as BrowserRequest, Response as BrowserResponse, Frame } from '@playwright/test';

type Operation = 'consent' | 'login/complete';
type Capture = { id: string; url: string; status: number; cacheControl: string | null; contentType: string | null; bytes: number[] };
type CaptureApi = { arm(id: string, operation: Operation): void; take(id: string): Promise<Capture>; check(): void };
type CaptureGlobal = typeof globalThis & { __mfSameResponse?: CaptureApi };

// Self-contained: Playwright serializes this function into the fresh fixture page.
export function installSameResponseCapture(options: { base: string; namespace: string }) {
    const host = globalThis as CaptureGlobal;
    const origin = new URL(options.base);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.origin !== options.base
        || options.namespace !== '/api/settings/ai/chatgpt/synthesis/' || host.__mfSameResponse) throw new Error('ORACLE_INSTALL_INVALID');
    const nativeFetch = globalThis.fetch;
    const limit = 262144;
    type Record = { id: string; url: string; count: number; error: string | null; eof: boolean; taken: boolean;
        pending: number; readers: number; length: number; bytes: Uint8Array; response?: Response;
        signal?: AbortSignal | null; abort?: () => void; wake: () => void; done: Promise<void> };
    let current: Record | undefined;
    let violation: string | null = null;
    function fail(record: Record, code: string) { record.error ??= code; record.wake(); }
    function check() { if (violation) throw new Error(violation); if (current?.error) throw new Error(current.error); }
    const api: CaptureApi = {
        arm(id, operation) {
            check();
            if (!id || !['consent', 'login/complete'].includes(operation) || current && !current.taken) throw new Error('ORACLE_ARM_INVALID');
            if (current?.signal && current.abort) current.signal.removeEventListener('abort', current.abort);
            let wake!: () => void;
            const done = new Promise<void>(resolve => { wake = resolve; });
            current = { id, url: options.base + options.namespace + operation, count: 0, error: null, eof: false, taken: false,
                pending: 0, readers: 0, length: 0, bytes: new Uint8Array(limit), wake, done };
        },
        async take(id) {
            const record = current;
            if (!record || record.id !== id || record.taken) throw new Error('ORACLE_TICKET_INVALID');
            await record.done;
            check();
            const response = record.response;
            if (record.taken || current !== record || record.count !== 1 || record.readers !== 1 || !record.eof || record.pending
                || !response || !response.bodyUsed || record.signal?.aborted) throw new Error('ORACLE_BODY_INCOMPLETE');
            if (response.url !== record.url || response.redirected || response.type !== 'basic') throw new Error('ORACLE_RESPONSE_IDENTITY');
            record.taken = true;
            if (record.signal && record.abort) record.signal.removeEventListener('abort', record.abort);
            return { id, url: response.url, status: response.status, cacheControl: response.headers.get('cache-control'),
                contentType: response.headers.get('content-type'), bytes: Array.from(record.bytes.subarray(0, record.length)) };
        },
        check() { check(); if (current && !current.taken) throw new Error('ORACLE_UNCONSUMED_TICKET'); },
    };
    Object.defineProperty(host, '__mfSameResponse', { value: Object.freeze(api), configurable: false });
    globalThis.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        // Only this real caller's selected POST is observed. Arguments and native
        // promise/Response/stream/reader/read-promise identity are preserved.
        const url = new URL(input instanceof Request ? input.url : String(input), globalThis.location.href).href;
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const selected = method === 'POST' && [options.base + options.namespace + 'consent', options.base + options.namespace + 'login/complete'].includes(url);
        const record = selected && current?.url === url && !current.taken ? current : undefined;
        if (selected && !record && url.endsWith('/consent')) violation ??= 'ORACLE_UNARMED_CONSENT';
        if (record) {
            record.count++;
            if (record.count !== 1) fail(record, 'ORACLE_DUPLICATE_REQUEST');
            else {
                record.signal = init?.signal ?? (input instanceof Request ? input.signal : null);
                record.abort = () => fail(record, 'ORACLE_SIGNAL_ABORTED');
                record.signal?.addEventListener('abort', record.abort, { once: true });
                if (record.signal?.aborted) fail(record, 'ORACLE_SIGNAL_ABORTED');
            }
        }
        let promise: Promise<Response>;
        try { promise = Reflect.apply(nativeFetch, this, [input, init]); }
        catch (error) { if (record) fail(record, 'ORACLE_FETCH_REJECTED'); throw error; }
        if (record && record.count === 1) {
            // An extra observation reaction does affect scheduling. It does not
            // replace a native promise or consume data; tests cover that boundary.
            void promise.then(response => {
                try {
                    record.response = response; // Hold THIS Response through the network/EOF assertion, never a server substitute.
                    const stream = response.body;
                    if (!stream) { fail(record, 'ORACLE_BODY_MISSING'); return; }
                    const getReader = stream.getReader;
                    Object.defineProperty(stream, 'getReader', { configurable: true, value: function(this: ReadableStream<Uint8Array>, ...args: []) {
                        const reader = Reflect.apply(getReader, this, args) as ReadableStreamDefaultReader<Uint8Array>;
                        record.readers++;
                        if (this !== stream || record.readers !== 1 || args.length) fail(record, 'ORACLE_READER_INVALID');
                        const read = reader.read, cancel = reader.cancel;
                        Object.defineProperty(reader, 'read', { configurable: true, value: function(this: ReadableStreamDefaultReader<Uint8Array>) {
                            const result = Reflect.apply(read, this, []) as ReturnType<typeof read>;
                            record.pending++;
                            void result.then(part => {
                                record.pending--;
                                try {
                                    if (part.done) { record.eof = true; record.wake(); }
                                    else if (!(part.value instanceof Uint8Array) || record.length + part.value.byteLength > limit) fail(record, 'ORACLE_BODY_LIMIT_OR_TYPE');
                                    else { record.bytes.set(part.value, record.length); record.length += part.value.byteLength; }
                                } catch { fail(record, 'ORACLE_OBSERVER_FAILED'); }
                            }, () => { record.pending--; fail(record, 'ORACLE_READ_REJECTED'); });
                            return result;
                        } });
                        Object.defineProperty(reader, 'cancel', { configurable: true, value: function(this: ReadableStreamDefaultReader<Uint8Array>, reason?: unknown) {
                            // done:true AFTER cancel is not evidence of natural EOF.
                            if (!record.eof) fail(record, 'ORACLE_CANCEL_BEFORE_EOF');
                            return Reflect.apply(cancel, this, [reason]);
                        } });
                        return reader;
                    } });
                } catch { fail(record, 'ORACLE_OBSERVER_FAILED'); }
            }, () => fail(record, 'ORACLE_FETCH_REJECTED'));
        }
        return promise;
    };
}

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
        let settleResponse!: (response: BrowserResponse) => void, settleFinished!: () => void, reject!: (error: Error) => void;
        const response = new Promise<BrowserResponse>(resolve => { settleResponse = resolve; });
        const finished = new Promise<void>(resolve => { settleFinished = resolve; });
        const failure = new Promise<never>((_, fail) => { reject = fail; });
        // The same rejection is raced by response/json. Mark it handled during the
        // user's click without converting it into a success or changing its cause.
        void failure.catch(() => {});
        const fail = (code: string) => reject(new Error(code));
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
        const onFinished = (value: BrowserRequest) => { if (value === request) settleFinished(); };
        const onFailed = (value: BrowserRequest) => { if (value === request) fail(`ORACLE_NETWORK_FAILED: ${value.failure()?.errorText ?? 'unknown'}`); };
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
                    // CDP loadingFailed is NOT accepted even when renderer bytes
                    // happen to form valid JSON. No body-cache retrieval or fallback.
                    await Promise.race([finished, failure]);
                    const capture = await Promise.race([page.evaluate(id => {
                        const api = (globalThis as CaptureGlobal).__mfSameResponse;
                        if (!api) throw new Error('ORACLE_NOT_INSTALLED'); return api.take(id);
                    }, id), failure]);
                    assert.strictEqual(received.request(), request, 'ORACLE_BROWSER_REQUEST_MISMATCH');
                    assert.equal(request!.failure(), null, 'ORACLE_BROWSER_REQUEST_FAILED');
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
