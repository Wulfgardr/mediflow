export type CaptureOperation = 'consent' | 'login/complete' | 'project';
export type Capture = { id: string; url: string; status: number; cacheControl: string | null; contentType: string | null; bytes: number[]; grant: string | null };
export type CaptureApi = { arm(id: string, operation: CaptureOperation): void; take(id: string): Promise<Capture>; check(): void; dispose(): void };
export type CaptureGlobal = typeof globalThis & { __mfSameResponse?: CaptureApi };

// Self-contained: Playwright serializes this function into the fresh fixture page.
export function installSameResponseCapture(options: { base: string; namespace: string; projectUrl?: string }) {
    const host = globalThis as CaptureGlobal;
    const origin = new URL(options.base);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.origin !== options.base
        || options.namespace !== '/api/settings/ai/chatgpt/synthesis/' || host.__mfSameResponse) throw new Error('ORACLE_INSTALL_INVALID');
    const nativeFetch = globalThis.fetch;
    const limit = options.projectUrl ? 8 * 1024 * 1024 + 4096 + 2048 : 262144;
    if (options.projectUrl && (new URL(options.projectUrl).origin !== options.base
        || !/^\/api\/attachments\/[^/]+\/local-extraction$/u.test(new URL(options.projectUrl).pathname))) throw new Error('ORACLE_INSTALL_INVALID');
    const urlFor = (operation: CaptureOperation) => operation === 'project' ? options.projectUrl! : options.base + options.namespace + operation;
    type Record = { id: string; url: string; count: number; error: string | null; eof: boolean; taken: boolean;
        pending: number; readers: number; length: number; bytes: Uint8Array; response?: Response; grant?: string | null;
        signal?: AbortSignal | null; abort?: () => void; wake: () => void; done: Promise<void> };
    let current: Record | undefined;
    let violation: string | null = null;
    function fail(record: Record, code: string) { record.error ??= code; record.wake(); }
    function check() { if (violation) throw new Error(violation); if (current?.error) throw new Error(current.error); }
    const api: CaptureApi = {
        arm(id, operation) {
            check();
            if (!id || !(options.projectUrl ? ['project'] : ['consent', 'login/complete']).includes(operation) || current && !current.taken) throw new Error('ORACLE_ARM_INVALID');
            if (current?.signal && current.abort) current.signal.removeEventListener('abort', current.abort);
            let wake!: () => void;
            const done = new Promise<void>(resolve => { wake = resolve; });
            current = { id, url: urlFor(operation), count: 0, error: null, eof: false, taken: false,
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
                contentType: response.headers.get('content-type'), bytes: Array.from(record.bytes.subarray(0, record.length)), grant: record.grant ?? null };
        },
        check() { check(); if (current && !current.taken) throw new Error('ORACLE_UNCONSUMED_TICKET'); },
        dispose() {
            if (current?.signal && current.abort) current.signal.removeEventListener('abort', current.abort);
            if (current) { fail(current, 'ORACLE_DISPOSED'); current.bytes.fill(0); }
            if (host.fetch === wrappedFetch) host.fetch = nativeFetch;
            delete host.__mfSameResponse;
        },
    };
    Object.defineProperty(host, '__mfSameResponse', { value: Object.freeze(api), configurable: true });
    const wrappedFetch: typeof fetch = function(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        // Only this real caller's selected POST is observed. Arguments and native
        // promise/Response/stream/reader/read-promise identity are preserved.
        const url = new URL(input instanceof Request ? input.url : String(input), globalThis.location.href).href;
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        const selected = method === 'POST' && (options.projectUrl
            ? url === options.projectUrl && headers.get('x-mediflow-extraction-action') === 'project'
            : [urlFor('consent'), urlFor('login/complete')].includes(url));
        const record = selected && current?.url === url && !current.taken ? current : undefined;
        if (selected && !record && (options.projectUrl || url.endsWith('/consent'))) violation ??= 'ORACLE_UNARMED_CONSENT';
        if (record) {
            record.count++;
            record.grant = headers.get('x-mediflow-extraction-grant');
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
    globalThis.fetch = wrappedFetch;
}

