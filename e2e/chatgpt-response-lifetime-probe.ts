/* @Codex — diagnostic-only, passive and synthetic. Never a body fallback.
 * No extra fetch, response.body(), CDP session, tracing, routing or timers.
 * Keep the first bounded event prefix: overflow is explicit, not a clean trace.
 */
import { createHash } from 'node:crypto';
import type { Page, ConsoleMessage, Request as BrowserRequest, Response as BrowserResponse, WebSocket } from '@playwright/test';

const EVENT_LIMIT = 512;
const LISTENER_LIMIT = 128;
const namespace = '/api/settings/ai/chatgpt/synthesis/';
const operations = new Set(['status', 'prepare', 'consent', 'login/start', 'login/complete', 'login/cancel', 'read', 'models', 'generate', 'cancel', 'logout']);
const hmrActions = new Set(['sync', 'building', 'built', 'reloadPage', 'serverComponentChanges', 'serverOnlyChanges', 'serverError']);
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

export function createResponseLifetimeProbe() {
    const startedAtUnixMs = Date.now(), started = performance.now();
    const events: Entry[] = [], remove: (() => void)[] = [];
    const requests = new WeakMap<BrowserRequest, number>();
    let sequence = 0, dropped = 0, requestSequence = 0, wireSequence = 0, documentSequence = 0;
    let disposed = false, listenerOverflow = false, base = '', hmrFrames = 0, gatewayPort = 0;
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
                if (text.includes('[Fast Refresh]') || text.includes('[HMR]')) record('browser/hmr-console', {
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
                        if (value && typeof value === 'object' && 'action' in value && typeof value.action === 'string' && hmrActions.has(value.action)) action = value.action;
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
                startedAtUnixMs, gatewayPort, complete: dropped === 0 && !listenerOverflow, dropped, listenerOverflow, hmrFrames,
                // Zero frames does NOT exclude HMR: routeWebSocket may hide its
                // underlying socket from Page events. Main-frame commits still count.
                hmrFrameAbsenceExcludesRefresh: false, events: events.map(event => ({ ...event })) };
        },
        dispose() { if (disposed) return; disposed = true; for (const off of remove.splice(0).reverse()) off(); },
    };
}
export type ResponseLifetimeProbe = ReturnType<typeof createResponseLifetimeProbe>;
