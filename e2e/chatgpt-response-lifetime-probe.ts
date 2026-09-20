/* @Codex — diagnostic-only, passive and synthetic. Never a body fallback.
 * No extra fetch, response.body(), CDP session, tracing, routing or timers.
 * Keep the first bounded event prefix: overflow is explicit, not a clean trace.
 */
import { createHash } from 'node:crypto';
import type { Page, BrowserContext, ConsoleMessage, Request as BrowserRequest, Response as BrowserResponse, WebSocket } from '@playwright/test';

const EVENT_LIMIT = 512;
const LISTENER_LIMIT = 128;
const namespace = '/api/settings/ai/chatgpt/synthesis/';
const operations = new Set(['status', 'prepare', 'consent', 'login/start', 'login/complete', 'login/cancel', 'read', 'models', 'generate', 'cancel', 'logout']);
const hmrActions = new Set(['sync', 'building', 'built', 'reloadPage', 'serverComponentChanges', 'serverOnlyChanges', 'serverError']);
const pageProbePrefix = '[mediflow-response-lifetime]';
type Fields = Record<string, string | number | boolean | null>;
type Entry = Fields & { sequence: number; milliseconds: number; event: string };
type Phase = 'scenario-start' | 'ui-ready' | 'consent-wait-armed' | 'consent-http-asserted'
    | 'scenario-work-succeeded' | 'scenario-cleanup-start' | 'context-close-start' | 'gateway-close-start'
    | 'scenario-succeeded' | 'scenario-failed';

function errorClass(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('Network.getResponseBody') && message.includes('No data found for resource with given identifier')) return 'cdp-body-resource-missing';
    if (message.includes('evicted from inspector cache')) return 'cdp-body-evicted';
    if (message.includes('Target page, context or browser has been closed')) return 'target-closed';
    if (message.includes('Network.getResponseBody')) return 'cdp-body-other';
    if (error instanceof SyntaxError) return 'invalid-json';
    return 'other';
}
function failureClass(text: string | undefined): string {
    if (text?.includes('ERR_ABORTED')) return 'aborted';
    if (text?.includes('ERR_FAILED')) return 'failed';
    if (text?.includes('ERR_CONNECTION')) return 'connection';
    if (text?.includes('ERR_INCOMPLETE_CHUNKED_ENCODING')) return 'incomplete-body';
    return text ? 'other' : 'none';
}

/** Runs before application code. It observes only existing reads/cancels/aborts,
 * returns every original object and promise, and never accesses Response.body.
 * Response.body/getReader are observable only when application code uses those
 * public getters; native internal consumption is outside this probe's view. */
export function installPageResponseLifetimeProbe(realm: typeof globalThis = globalThis) {
    const PREFIX = '[mediflow-response-lifetime]';
    const marker = Symbol.for('mediflow.synthetic-response-lifetime-page.v1');
    const owned = realm as typeof globalThis & { [marker]?: () => void };
    if (owned[marker]) return;
    const NS = '/api/settings/ai/chatgpt/synthesis/';
    const OPS = new Set(['status', 'prepare', 'consent', 'login/start', 'login/complete', 'login/cancel', 'read', 'models', 'generate', 'cancel', 'logout']);
    const LIMIT = 256, statesByResponse = new WeakMap<Response, State>(), statesByStream = new WeakMap<ReadableStream, State>();
    const statesByReader = new WeakMap<object, State>(), statesBySignal = new WeakMap<AbortSignal, Set<State>>();
    let emitted = 0, counter = 0;
    type State = { counter: number; operation: string; reads: number; bytesRead: number; doneSeen: boolean };
    const site = () => { const stack = new Error().stack ?? ''; return stack.includes('readResponse') ? 'readResponse'
        : stack.includes('setActive') ? 'setActive' : /(?:\bat |@)run\b/u.test(stack) ? 'run' : 'other'; };
    const emit = (event: string, state: State | null, fields: Record<string, string | number | boolean> = {}) => {
        if (emitted >= LIMIT) {
            if (emitted++ === LIMIT) try { realm.console.debug(PREFIX + JSON.stringify({ schema: 'mediflow.synthetic-response-lifetime-page.v1', event: 'probe/overflow', pageSequence: LIMIT + 1 })); } catch { /* diagnostic only */ }
            return;
        }
        emitted++;
        try { realm.console.debug(PREFIX + JSON.stringify({ schema: 'mediflow.synthetic-response-lifetime-page.v1', event, pageSequence: emitted,
            ...(state ? { operation: state.operation, counter: state.counter } : {}), ...fields })); } catch { /* diagnostic only */ }
    };
    const operation = (input: RequestInfo | URL): string | null => {
        try {
            const raw = typeof input === 'string' ? input : input instanceof realm.URL ? input.href : input.url;
            const pathname = new realm.URL(raw, realm.location?.href ?? 'http://localhost').pathname;
            const suffix = pathname.slice(NS.length); return pathname.startsWith(NS) && OPS.has(suffix) ? suffix : null;
        } catch { return null; }
    };
    const observeSignal = (signal: AbortSignal | null | undefined, state: State) => {
        if (!signal) return;
        let states = statesBySignal.get(signal);
        if (!states) { states = new Set(); statesBySignal.set(signal, states); }
        states.add(state);
        const aborted = () => emit('signal/abort', state, { doneSeen: state.doneSeen, bytesRead: state.bytesRead, callSite: site() });
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
    };
    const originalFetch = realm.fetch;
    realm.fetch = function(this: typeof globalThis, input: RequestInfo | URL, init?: RequestInit) {
        const op = operation(input); const pending = originalFetch.call(this, input, init);
        if (!op) return pending;
        const state: State = { counter: ++counter, operation: op, reads: 0, bytesRead: 0, doneSeen: false };
        const signal = init?.signal ?? (realm.Request && input instanceof realm.Request ? input.signal : null);
        observeSignal(signal, state); emit('fetch/call', state, { signal: !!signal, signalAborted: signal?.aborted === true, callSite: site() });
        void pending.then(response => { statesByResponse.set(response, state); emit('fetch/resolved', state); }, error => {
            emit('fetch/rejected', state, { failure: error instanceof realm.DOMException && error.name === 'AbortError' ? 'abort' : 'other' });
        });
        return pending;
    } as typeof fetch;
    const responseBody = Object.getOwnPropertyDescriptor(realm.Response.prototype, 'body');
    if (responseBody?.get) Object.defineProperty(realm.Response.prototype, 'body', { ...responseBody, get() {
        const stream = responseBody.get!.call(this) as ReadableStream | null, state = statesByResponse.get(this as Response);
        if (stream && state) { statesByStream.set(stream, state); emit('response/body', state, { callSite: site() }); }
        return stream;
    } });
    const getReader = realm.ReadableStream && Object.getOwnPropertyDescriptor(realm.ReadableStream.prototype, 'getReader')?.value;
    if (typeof getReader === 'function') realm.ReadableStream.prototype.getReader = function(this: ReadableStream, ...args: Parameters<ReadableStream['getReader']>) {
        const reader = getReader.apply(this, args), state = statesByStream.get(this);
        if (state) { statesByReader.set(reader, state); emit('stream/get-reader', state, { callSite: site() }); }
        return reader;
    } as ReadableStream['getReader'];
    const patchReader = (prototype: object | undefined) => {
        if (!prototype) return;
        const originalRead = Object.getOwnPropertyDescriptor(prototype, 'read')?.value;
        if (typeof originalRead === 'function') Object.defineProperty(prototype, 'read', { configurable: true, writable: true, value: function(...args: unknown[]) {
            const state = statesByReader.get(this as object), pending = originalRead.apply(this, args);
            if (!state) return pending;
            const read = ++state.reads; emit('reader/read-call', state, { read, callSite: site() });
            void pending.then((result: { done?: unknown; value?: unknown }) => {
                const done = result?.done === true; let bytes = 0;
                try { const size = (result?.value as { byteLength?: unknown } | null)?.byteLength; if (Number.isSafeInteger(size) && (size as number) >= 0) bytes = size as number; } catch { /* metadata unavailable */ }
                state.doneSeen ||= done; state.bytesRead = Math.min(Number.MAX_SAFE_INTEGER, state.bytesRead + bytes);
                emit('reader/read-settled', state, { read, done, bytes, bytesRead: state.bytesRead });
            }, (error: unknown) => emit('reader/read-rejected', state, { read, failure: error instanceof realm.DOMException && error.name === 'AbortError' ? 'abort' : 'other' }));
            return pending;
        } });
        const originalCancel = Object.getOwnPropertyDescriptor(prototype, 'cancel')?.value;
        if (typeof originalCancel === 'function') Object.defineProperty(prototype, 'cancel', { configurable: true, writable: true, value: function(...args: unknown[]) {
            const state = statesByReader.get(this as object);
            if (state) emit('reader/cancel-call', state, { doneSeen: state.doneSeen, bytesRead: state.bytesRead, callSite: site() });
            return originalCancel.apply(this, args);
        } });
    };
    patchReader(realm.ReadableStreamDefaultReader?.prototype); patchReader(realm.ReadableStreamBYOBReader?.prototype);
    const streamCancel = realm.ReadableStream && Object.getOwnPropertyDescriptor(realm.ReadableStream.prototype, 'cancel')?.value;
    if (typeof streamCancel === 'function') realm.ReadableStream.prototype.cancel = function(...args: Parameters<ReadableStream['cancel']>) {
        const state = statesByStream.get(this); if (state) emit('stream/cancel-call', state, { doneSeen: state.doneSeen, bytesRead: state.bytesRead, callSite: site() });
        return streamCancel.apply(this, args);
    };
    const abort = Object.getOwnPropertyDescriptor(realm.AbortController.prototype, 'abort')?.value;
    if (typeof abort === 'function') realm.AbortController.prototype.abort = function(...args: Parameters<AbortController['abort']>) {
        const states = statesBySignal.get(this.signal); if (states) for (const state of states) emit('abort-controller/call', state,
            { doneSeen: state.doneSeen, bytesRead: state.bytesRead, callSite: site() });
        return abort.apply(this, args);
    };
    // A same-context, pre-cleanup fence for the existing observer, not another
    // read or a new observation layer. Sequence gaps prohibit negative inference.
    owned[marker] = () => emit('probe/checkpoint', null);
    emit('probe/armed', null);
}

export function createResponseLifetimeProbe() {
    const startedAtUnixMs = Date.now(), started = performance.now();
    const events: Entry[] = [], remove: (() => void)[] = [];
    const requests = new WeakMap<BrowserRequest, number>();
    let sequence = 0, dropped = 0, requestSequence = 0, wireSequence = 0, documentSequence = 0;
    let disposed = false, listenerOverflow = false, pageProbeOverflow = false, base = '', hmrFrames = 0, gatewayPort = 0;
    function record(event: string, fields: Fields = {}) {
        if (disposed) return;
        sequence++;
        if (events.length >= EVENT_LIMIT) { dropped++; return; }
        events.push({ sequence, milliseconds: Math.round((performance.now() - started) * 1000) / 1000, event, ...fields });
    }
    function pathClass(raw: string): string {
        try {
            const url = new URL(raw);
            if (url.origin !== base && url.origin !== base.replace('http:', 'ws:')) return 'external';
            const suffix = url.pathname.slice(namespace.length);
            if (url.pathname.startsWith(namespace) && operations.has(suffix)) return suffix;
            if (url.pathname === '/') return 'document';
            if (url.pathname === '/_next/hmr') return 'hmr';
            if (url.pathname.startsWith('/_next/static/')) return 'next-static';
            return 'other-local';
        } catch { return 'invalid-url'; }
    }
    function requestFields(request: BrowserRequest): Fields {
        let id = requests.get(request);
        if (id === undefined) { id = ++requestSequence; requests.set(request, id); }
        return { request: id, route: pathClass(request.url()), method: request.method() === 'POST' ? 'POST' : request.method() === 'GET' ? 'GET' : 'other',
            navigation: request.isNavigationRequest(), redirected: request.redirectedFrom() !== null };
    }
    // Register through typed closures: no private Playwright API or replacement
    // emitter. Every listener stays owned until dispose, including closed sockets.
    function own(add: () => void, off: () => void) {
        if (disposed) return;
        if (remove.length >= LISTENER_LIMIT) { listenerOverflow = true; return; }
        add(); remove.push(off);
    }
    function attach(page: Page, origin: string, observeResponse?: (response: BrowserResponse) => void) {
        base = new URL(origin).origin; gatewayPort = Number(new URL(origin).port);
        const request = (value: BrowserRequest) => record('browser/request', requestFields(value));
        const response = (value: BrowserResponse) => {
            observeResponse?.(value);
            record('browser/response', { ...requestFields(value.request()), status: value.status(),
                noStore: value.headers()['cache-control'] === 'no-store', serviceWorker: value.fromServiceWorker() });
        };
        const finished = (value: BrowserRequest) => record('browser/requestfinished', requestFields(value));
        const failed = (value: BrowserRequest) => record('browser/requestfailed', { ...requestFields(value), failure: failureClass(value.failure()?.errorText) });
        const navigated = (frame: ReturnType<Page['mainFrame']>) => {
            if (frame === page.mainFrame()) record('browser/main-frame-commit', { document: ++documentSequence, route: pathClass(frame.url()) });
        };
        const detached = (frame: ReturnType<Page['mainFrame']>) => record('browser/frame-detached', { main: frame === page.mainFrame() });
        const closed = () => record('browser/page-closed');
        const crashed = () => record('browser/page-crashed');
        const contextClosed = () => record('browser/context-closed');
        const disconnected = () => record('browser/disconnected');
        const consoleMessage = (message: ConsoleMessage) => {
            // Avoid retaining text, URLs, errors, source contents or login challenges.
            if ('text' in message && typeof message.text === 'function') {
                const text = message.text();
                if (text.startsWith(pageProbePrefix)) {
                    try {
                        const value: unknown = JSON.parse(text.slice(pageProbePrefix.length));
                        if (value && typeof value === 'object' && 'schema' in value && value.schema === 'mediflow.synthetic-response-lifetime-page.v1'
                            && 'event' in value && typeof value.event === 'string') {
                            const scalars = value as Record<string, unknown>;
                            const allowedEvents = new Set(['probe/overflow', 'probe/armed', 'probe/checkpoint', 'fetch/call', 'fetch/resolved', 'fetch/rejected', 'response/body', 'stream/get-reader',
                                'stream/cancel-call', 'reader/read-call', 'reader/read-settled', 'reader/read-rejected', 'reader/cancel-call',
                                'abort-controller/call', 'signal/abort']);
                            const operation = 'operation' in value && typeof value.operation === 'string' && operations.has(value.operation) ? value.operation : 'other';
                            const callSite = 'callSite' in value && ['readResponse', 'setActive', 'run', 'other'].includes(String(value.callSite)) ? String(value.callSite) : 'other';
                            if (allowedEvents.has(value.event)) { if (value.event === 'probe/overflow') pageProbeOverflow = true; record(`page/${value.event}`, { operation, callSite,
                                ...(['counter', 'read', 'bytes', 'bytesRead', 'pageSequence'] as const).reduce<Fields>((fields, key) => {
                                    const current = scalars[key]; if (typeof current === 'number' && Number.isSafeInteger(current) && current >= 0) fields[key] = current; return fields;
                                }, {}), ...(['done', 'doneSeen', 'signal', 'signalAborted'] as const).reduce<Fields>((fields, key) => {
                                    const current = scalars[key]; if (typeof current === 'boolean') fields[key] = current; return fields;
                                }, {}), ...('failure' in value && ['abort', 'other'].includes(String(value.failure)) ? { failure: String(value.failure) } : {}) }); }
                        }
                    } catch { /* Untrusted console text is discarded. */ }
                } else if (text.includes('[Fast Refresh]') || text.includes('[HMR]')) record('browser/hmr-console', {
                    reload: /reload/i.test(text), rebuilding: /rebuild|building/i.test(text) });
            }
        };
        const websocket = (socket: WebSocket) => {
            if (pathClass(socket.url()) !== 'hmr') return;
            record('browser/hmr-socket');
            const frame = ({ payload }: { payload: string | Buffer }) => {
                hmrFrames++;
                let action = 'unknown';
                if (Buffer.byteLength(payload) <= 65536) {
                    try {
                        const value: unknown = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8'));
                        if (value && typeof value === 'object') {
                            const candidate = 'type' in value && typeof value.type === 'string' ? value.type
                                : 'action' in value && typeof value.action === 'string' ? value.action : null;
                            if (candidate && hmrActions.has(candidate)) action = candidate;
                        }
                    } catch { /* Non-JSON HMR frames are recorded, never forwarded or changed here. */ }
                }
                record('browser/hmr-frame', { action });
            };
            const close = () => record('browser/hmr-closed');
            own(() => socket.on('framereceived', frame), () => socket.off('framereceived', frame));
            own(() => socket.on('close', close), () => socket.off('close', close));
        };
        own(() => page.on('request', request), () => page.off('request', request));
        own(() => page.on('response', response), () => page.off('response', response));
        own(() => page.on('requestfinished', finished), () => page.off('requestfinished', finished));
        own(() => page.on('requestfailed', failed), () => page.off('requestfailed', failed));
        own(() => page.on('framenavigated', navigated), () => page.off('framenavigated', navigated));
        own(() => page.on('framedetached', detached), () => page.off('framedetached', detached));
        own(() => page.on('close', closed), () => page.off('close', closed));
        own(() => page.on('crash', crashed), () => page.off('crash', crashed));
        own(() => page.on('console', consoleMessage), () => page.off('console', consoleMessage));
        own(() => page.on('websocket', websocket), () => page.off('websocket', websocket));
        const context = page.context(), browser = context.browser();
        own(() => context.on('close', contextClosed), () => context.off('close', contextClosed));
        if (browser) own(() => browser.on('disconnected', disconnected), () => browser.off('disconnected', disconnected));
    }
    return {
        async arm(context: BrowserContext): Promise<void> { await context.addInitScript(installPageResponseLifetimeProbe as () => void); },
        async checkpoint(context: BrowserContext): Promise<void> {
            const pages = context.pages();
            if (pages.length !== 1) throw new Error('CALLER_CHECKPOINT_PAGE_AMBIGUOUS');
            await pages[0].evaluate(() => {
                const marker = Symbol.for('mediflow.synthetic-response-lifetime-page.v1');
                const checkpoint = (globalThis as typeof globalThis & { [marker]?: () => void })[marker];
                if (typeof checkpoint !== 'function') throw new Error('CALLER_CHECKPOINT_NOT_ARMED');
                checkpoint();
            });
        },
        attach,
        phase(phase: Phase) { record(phase); },
        wireRequest(operation: string, method: string, received: Headers, origin: string): number {
            const wire = ++wireSequence;
            record('wire/request', { wire, route: operations.has(operation) ? operation : 'other', method: method === 'POST' ? 'POST' : method === 'GET' ? 'GET' : 'other',
                originMatches: received.get('origin') === origin, fetchSameOrigin: received.get('sec-fetch-site') === 'same-origin',
                json: received.get('content-type') === 'application/json' });
            return wire;
        },
        wireReply(wire: number, response: Response, body: Buffer) {
            record('wire/root-body-ready', { wire, status: response.status, noStore: response.headers.get('cache-control') === 'no-store',
                bytes: body.byteLength, sha256: createHash('sha256').update(body).digest('hex') });
        },
        wireEvent(event: 'finish' | 'close' | 'abort' | 'error', wire: number, finished: boolean) {
            record(`wire/${event}`, { wire, finished });
        },
        hmrUpgrade() { record('wire/hmr-upgrade'); },
        async json(response: BrowserResponse): ReturnType<BrowserResponse['json']> {
            const fields = requestFields(response.request());
            record('body/read-start', fields);
            try {
                // EXACTLY the original read, at the original call site. No eager
                // buffering, finished() wait, retry, CDP command or server fallback.
                const result = await response.json();
                record('body/read-succeeded', fields);
                return result;
            } catch (error) {
                record('body/read-failed', { ...fields, failure: errorClass(error) });
                throw error;
            }
        },
        snapshot() {
            return { schema: 'mediflow.synthetic-response-lifetime.v1', observation: 'passive-public-events-not-cdp-session-storage',
                startedAtUnixMs, gatewayPort, complete: dropped === 0 && !listenerOverflow && !pageProbeOverflow, dropped, listenerOverflow, pageProbeOverflow, hmrFrames,
                // Zero frames does NOT exclude HMR: routeWebSocket may hide its
                // underlying socket from Page events. Main-frame commits still count.
                hmrFrameAbsenceExcludesRefresh: false, events: events.map(event => ({ ...event })) };
        },
        dispose() { if (disposed) return; disposed = true; for (const off of remove.splice(0).reverse()) off(); },
    };
}
export type ResponseLifetimeProbe = ReturnType<typeof createResponseLifetimeProbe>;
