/** Test-only, installed before the real Card loads. Never import into production. */
export function productDiagnosticHeaders(get: (name: string) => string | null | undefined) {
    const allowed = { 'content-type': /^application\/json(?:;\s*charset=utf-8)?$/iu, 'content-length': /^\d{1,10}$/u,
        'transfer-encoding': /^chunked$/iu, connection: /^(?:close|keep-alive)$/iu, 'cache-control': /^no-store$/iu };
    return Object.entries(allowed).map(([name, pattern]) => { const value = get(name); return [name, value == null ? null : pattern.test(value) ? value.toLowerCase() : 'redacted']; });
}

/** Probes run before activation; only the first real POST of each operation counts. */
export function createProductWireDiagnostic(record: (kind: string, detail: unknown) => void) {
    let active = false;
    const selected = new Set<string>();
    return {
        activate() { active = true; },
        select(operation: string, method: string | undefined) {
            if (!active || method !== 'POST' || !['consent', 'login/complete'].includes(operation) || selected.has(operation)) return undefined;
            selected.add(operation);
            return (kind: string, detail: Record<string, unknown> = {}) => record(kind, { operation, request: `${operation}:1`, ...detail });
        },
    };
}

/** Observe native identities, never replace a response/body or call another read. */
export function installProductResponseDiagnostic() {
    type Operation = 'consent' | 'login/complete';
    type Selected = { operation: Operation; request: string; eof: boolean; bytes: number; wake(): void; settled: Promise<void> };
    type Host = typeof globalThis & { __mfContractDiagnostic?: { record(kind: string, detail: unknown): void };
        __mfProductDiagnostic?: { settled(): Promise<void>; dispose(): void } };
    const host = globalThis as Host, capture = host.__mfContractDiagnostic;
    if (!capture || host.__mfProductDiagnostic) return;
    const nativeFetch = globalThis.fetch, nativeAbort = AbortController.prototype.abort;
    const signals = new WeakMap<AbortSignal, Selected>(), selected = new Map<Operation, Selected>();
    const disposers: Array<() => void> = [];
    let last: Selected | undefined;
    const record = (item: Selected, kind: string, detail: Record<string, unknown> = {}) => {
        try { capture.record(kind, { operation: item.operation, request: item.request, ...detail }); } catch { /* observation cannot change native work */ }
    };
    const errorName = (error: unknown) => error instanceof Error && ['AbortError', 'TypeError'].includes(error.name) ? error.name : 'Other';
    const headers = (response: Response) => {
        const allowed = { 'content-type': /^application\/json(?:;\s*charset=utf-8)?$/iu, 'content-length': /^\d{1,10}$/u,
            'transfer-encoding': /^chunked$/iu, connection: /^(?:close|keep-alive)$/iu, 'cache-control': /^no-store$/iu };
        return Object.entries(allowed).map(([name, pattern]) => { const value = response.headers.get(name); return [name, value === null ? null : pattern.test(value) ? value.toLowerCase() : 'redacted']; });
    };
    function observedAbort(this: AbortController, ...args: Parameters<AbortController['abort']>) {
        const item = signals.get(this.signal);
        if (item) record(item, 'controller.abort', { alreadyAborted: this.signal.aborted });
        return Reflect.apply(nativeAbort, this, args);
    }
    AbortController.prototype.abort = observedAbort;
    function observedFetch(this: unknown, ...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
        const [input, init] = args;
        let item: Selected | undefined;
        try {
            const url = new URL(input instanceof Request ? input.url : String(input), location.href);
            const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
            const path = '/api/settings/ai/chatgpt/synthesis/';
            const operation = url.pathname.slice(path.length) as Operation;
            if (url.origin === location.origin && !url.search && url.pathname.startsWith(path) && method === 'POST'
                && ['consent', 'login/complete'].includes(operation) && !selected.has(operation)) {
                let wake!: () => void;
                const settled = new Promise<void>(resolve => { wake = resolve; });
                item = { operation, request: `${operation}:1`, eof: false, bytes: 0, wake, settled };
                selected.set(operation, item); last = item;
                const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
                record(item, 'controller.fetch', { signalPresent: !!signal, signalAborted: signal?.aborted ?? false });
                if (signal) {
                    signals.set(signal, item);
                    const current = item, abort = () => record(current, 'signal.abort', { eof: current.eof });
                    signal.addEventListener('abort', abort, { once: true });
                    disposers.push(() => signal.removeEventListener('abort', abort));
                }
            }
        } catch { /* malformed/unselected input still follows native fetch */ }
        let promise: ReturnType<typeof fetch>;
        try { promise = Reflect.apply(nativeFetch, this, args); }
        catch (error) { if (item) { record(item, 'fetch.threw', { name: errorName(error) }); item.wake(); } throw error; }
        if (item) {
            const current = item;
            void promise.then(response => {
                try {
                    record(current, 'renderer.response', { status: response.status, headers: headers(response) });
                    const stream = response.body;
                    if (!stream) { record(current, 'reader.missing'); current.wake(); return; }
                    const nativeGetReader = stream.getReader;
                    Object.defineProperty(stream, 'getReader', { configurable: true, value: function(this: ReadableStream<Uint8Array>, ...readerArgs: []) {
                        const reader = Reflect.apply(nativeGetReader, this, readerArgs) as ReadableStreamDefaultReader<Uint8Array>;
                        const read = reader.read, cancel = reader.cancel;
                        record(current, 'reader.acquired');
                        Object.defineProperty(reader, 'read', { configurable: true, value: function(this: ReadableStreamDefaultReader<Uint8Array>) {
                            record(current, 'read.start');
                            const result = Reflect.apply(read, this, []) as ReturnType<typeof read>;
                            void result.then(part => {
                                try {
                                    const length = part.done ? 0 : part.value.byteLength;
                                    current.bytes += length; current.eof ||= part.done;
                                    record(current, 'read.result', { done: part.done, length, totalBytes: current.bytes });
                                } catch { record(current, 'observer.unavailable'); }
                            }, error => record(current, 'read.rejected', { name: errorName(error) }));
                            return result;
                        } });
                        Object.defineProperty(reader, 'cancel', { configurable: true, value: function(this: ReadableStreamDefaultReader<Uint8Array>, ...cancelArgs: Parameters<typeof cancel>) {
                            record(current, 'cancel.call', { eof: current.eof });
                            const result = Reflect.apply(cancel, this, cancelArgs) as ReturnType<typeof cancel>;
                            void result.then(() => { record(current, 'cancel.resolved', { eof: current.eof }); current.wake(); }, error => {
                                record(current, 'cancel.rejected', { name: errorName(error) }); current.wake();
                            });
                            return result;
                        } });
                        return reader;
                    } });
                } catch { record(current, 'observer.unavailable'); current.wake(); }
            }, error => { record(current, 'fetch.rejected', { name: errorName(error) }); current.wake(); });
        }
        return promise;
    }
    globalThis.fetch = observedFetch;
    Object.defineProperty(host, '__mfProductDiagnostic', { value: Object.freeze({
        settled: () => last?.settled ?? Promise.resolve(),
        dispose() {
            if (globalThis.fetch === observedFetch) globalThis.fetch = nativeFetch;
            if (AbortController.prototype.abort === observedAbort) AbortController.prototype.abort = nativeAbort;
            for (const dispose of disposers.splice(0)) dispose();
        },
    }) });
}
