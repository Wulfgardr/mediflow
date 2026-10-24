import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Page } from '@playwright/test';

const limits = { events: 128, stackDepth: 4, framesPerStack: 12, textCharacters: 192,
    eventBytes: 32768, journalBytes: 131072 };
const expectedSources: Record<string, string> = {
    'lib/inProcessFactory.js': '406a2ce0e50bf6c695a0fa018ac3dec505b60836710bbab797e11730c51917cc',
    'lib/server/chromium/crConnection.js': '0d41a058ad1f5c897329a9c821c52b952e0e709ab38c3e6e355224b167922f13',
    'lib/server/chromium/crNetworkManager.js': 'ad55830a87387450440a4b372ae6a93a6c91c089ccc1e72ffeb298662dddb744'
};
type Logger = (this: unknown, ...args: unknown[]) => unknown;
type Protocol = { _protocolLogger: Logger };
type Impl = { delegate: { _mainFrameSession: { _client: { _sessionId: string; _connection: Protocol } } };
    mainFrame(): { _id: string } };
type RecordValue = Record<string, unknown>;
const fixtureEvents = new Set(['armed', 'request', 'real-receipt-held', 'real-receipt-delivered', 'fixture-route-error',
    'delivery-release', 'native-pin-expect-entered', 'native-renew-isVisible-result', 'ready-between-native-queries',
    'native-renew-isEnabled-entered', 'observable-block-precondition', 'green-observable-completion',
    'fixture-dispose-entered', 'fixture-disposed', 'fixture-arm-failed']);
const booleanFields = new Set(['etagPresent', 'pinDisabled', 'formBusy', 'noLogin', 'visible', 'pinEnabled', 'pinEmpty']);
const countFields = new Set(['renewCount', 'loginRequests', 'lockRequests']);

export function installOfficialLockObservation(page: Page) {
    const require = createRequire(resolve(process.cwd(), 'package.json'));
    const lock = JSON.parse(readFileSync(resolve(process.cwd(), 'package-lock.json'), 'utf8'));
    for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
        if (require(`${name}/package.json`).version !== '1.58.2' || lock.packages[`node_modules/${name}`]?.version !== '1.58.2')
            throw new Error('OFFICIAL_LOCK_OBSERVER_INCOMPATIBLE_VERSION');
    }
    const core = dirname(require.resolve('playwright-core/package.json'));
    for (const [file, expected] of Object.entries(expectedSources)) {
        if (createHash('sha256').update(readFileSync(join(core, file))).digest('hex') !== expected)
            throw new Error('OFFICIAL_LOCK_OBSERVER_INCOMPATIBLE_SOURCE');
    }
    const client = (page as unknown as { _connection?: { toImpl(page: Page): Impl } })._connection;
    if (!client || typeof client.toImpl !== 'function') throw new Error('OFFICIAL_LOCK_OBSERVER_INCOMPATIBLE_CONNECTION');
    const impl = client.toImpl(page);
    const protocol = impl?.delegate?._mainFrameSession?._client?._connection;
    const descriptor = protocol && Object.getOwnPropertyDescriptor(protocol, '_protocolLogger');
    if (!protocol || !descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function' || !descriptor.writable)
        throw new Error('OFFICIAL_LOCK_OBSERVER_INCOMPATIBLE_LOGGER');
    const initialSession = impl.delegate._mainFrameSession._client._sessionId;
    const initialFrame = impl.mainFrame()._id;
    if (typeof initialSession !== 'string' || typeof initialFrame !== 'string')
        throw new Error('OFFICIAL_LOCK_OBSERVER_INCOMPATIBLE_CONTEXT');
    const origin = new URL(page.url()).origin;
    const previous: Logger = descriptor.value;
    const started = performance.now();
    const events: RecordValue[] = [];
    const errorCodes: Record<string, number> = {};
    let seq = 0, bytes = 0, dropped = 0, observerErrors = 0, metadataTruncated = false;
    let contextChanged = false, contextUnavailable = 0, missingInitiators = 0, missingStacks = 0, unavailableParents = 0, omittedScripts = 0;
    let restoration: { owned: boolean; descriptorRestored: boolean } | null = null;
    const fault = (code: string) => { observerErrors++; errorCodes[code] = (errorCodes[code] ?? 0) + 1; };
    const cut = (value: string) => {
        if (value.length > limits.textCharacters) { metadataTruncated = true; return value.slice(0, limits.textCharacters); }
        return value;
    };
    const id = (value: unknown) => {
        if (typeof value !== 'string' || !/^[A-Za-z0-9._-]*$/.test(value)) return null;
        return cut(value);
    };
    const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
    const append = (event: string, details: RecordValue = {}) => {
        const entry = { seq: ++seq, nodeMonotonicMs: performance.now() - started, event, ...details };
        const size = Buffer.byteLength(JSON.stringify(entry));
        if (events.length >= limits.events || size > limits.eventBytes || bytes + size > limits.journalBytes) { dropped++; return undefined; }
        events.push(entry); bytes += size; return entry;
    };
    const script = (value: unknown) => {
        if (typeof value !== 'string' || !value) { omittedScripts++; return null; }
        try {
            const url = new URL(value, origin);
            if (url.origin !== origin || !url.pathname.startsWith('/_next/') || !/\.m?js$/.test(url.pathname)) { omittedScripts++; return null; }
            return cut(url.pathname);
        } catch { omittedScripts++; return null; }
    };
    const stack = (value: unknown, depth = 0, seen = new Set<object>()): RecordValue | null => {
        if (!value || typeof value !== 'object') { missingStacks++; return null; }
        if (seen.has(value)) { fault('STACK_CYCLE'); return null; }
        if (depth >= limits.stackDepth) { metadataTruncated = true; return null; }
        seen.add(value);
        const raw = value as { callFrames?: unknown; parent?: unknown; parentId?: unknown };
        const allFrames = Array.isArray(raw.callFrames) ? raw.callFrames : [];
        if (allFrames.length > limits.framesPerStack) metadataTruncated = true;
        const frames = allFrames.slice(0, limits.framesPerStack).map((frame: RecordValue) => {
            const name = typeof frame.functionName === 'string' && /^[A-Za-z0-9_$ .<>\[\]-]*$/.test(frame.functionName)
                ? cut(frame.functionName) : null;
            return { function: name, scriptPath: script(frame.url), lineZeroBased: integer(frame.lineNumber), columnZeroBased: integer(frame.columnNumber) };
        });
        const parentState = raw.parent ? 'included' : raw.parentId ? 'unavailable' : 'none';
        if (parentState === 'unavailable') unavailableParents++;
        return { frames, parentState, parent: raw.parent ? stack(raw.parent, depth + 1, seen) : null };
    };
    const current = () => {
        try {
            const session = impl.delegate._mainFrameSession._client._sessionId;
            const frame = impl.mainFrame()._id;
            if (typeof session !== 'string' || typeof frame !== 'string') throw new Error('context');
            contextChanged ||= session !== initialSession || frame !== initialFrame;
            return { session, frame };
        } catch { contextUnavailable++; fault('CONTEXT_UNAVAILABLE'); return null; }
    };
    const collect = (direction: unknown, raw: unknown) => {
        if (direction !== 'receive' || !raw || typeof raw !== 'object') return;
        const message = raw as { method?: string; sessionId?: string; params?: RecordValue };
        if (message.method !== 'Network.requestWillBeSent') return;
        const params = message.params;
        const request = params?.request as { method?: unknown; url?: unknown } | undefined;
        if (!params || !request || typeof request.url !== 'string') return;
        const url = new URL(request.url);
        if (url.origin !== origin || !(request.method === 'POST' && url.pathname === '/api/auth/lock'
            || request.method === 'GET' && url.pathname === '/api/auth/check')) return;
        const context = current();
        const initiator = params.initiator as { type?: unknown; stack?: unknown } | undefined;
        if (!initiator) missingInitiators++;
        const initiatorType = typeof initiator?.type === 'string' && ['script', 'parser', 'preload', 'other', 'SignedExchange', 'preflight'].includes(initiator.type) ? initiator.type : null;
        append('network-request', { method: request.method, pathname: url.pathname,
            requestId: id(params.requestId), sessionId: id(message.sessionId), frameId: id(params.frameId),
            sameInitialSession: message.sessionId === initialSession, sameCurrentSession: context ? message.sessionId === context.session : null,
            sameInitialFrame: params.frameId === initialFrame, sameCurrentFrame: context ? params.frameId === context.frame : null,
            belongsToPage: message.sessionId === initialSession && params.frameId === initialFrame
                || Boolean(context && message.sessionId === context.session && params.frameId === context.frame),
            cdpTimestampSeconds: typeof params.timestamp === 'number' && Number.isFinite(params.timestamp) && params.timestamp >= 0 ? params.timestamp : null,
            initiator: { type: initiatorType, stack: stack(initiator?.stack) } });
    };
    const logger: Logger = function (this: unknown, ...args) {
        try { collect(args[0], args[1]); } catch { fault('COLLECT_FAILED'); }
        return Reflect.apply(previous, this, args);
    };
    Object.defineProperty(protocol, '_protocolLogger', { ...descriptor, value: logger });
    return {
        record(event: string, details: RecordValue = {}) {
            if (!fixtureEvents.has(event)) { fault('UNKNOWN_FIXTURE_EVENT'); return undefined; }
            const safe: RecordValue = {};
            for (const [key, value] of Object.entries(details)) {
                if (booleanFields.has(key) && typeof value === 'boolean'
                    || countFields.has(key) && integer(value) !== null
                    || key === 'status' && integer(value) !== null && Number(value) >= 100 && Number(value) <= 599
                    || key === 'pathname' && typeof value === 'string' && ['/api/auth/lock', '/api/auth/login'].includes(value)
                    || key === 'source' && typeof value === 'string' && ['pin-ready-assertion', 'renew-isVisible-true', 'cleanup'].includes(value)) safe[key] = value;
                else fault('FIXTURE_METADATA_REJECTED');
            }
            return append(event, safe);
        },
        restore() {
            if (restoration) return restoration;
            current();
            let owned = false, descriptorRestored = false;
            try {
                owned = protocol._protocolLogger === logger;
                if (owned) {
                    Object.defineProperty(protocol, '_protocolLogger', descriptor);
                    const actual = Object.getOwnPropertyDescriptor(protocol, '_protocolLogger');
                    descriptorRestored = actual?.value === previous && actual.writable === descriptor.writable
                        && actual.enumerable === descriptor.enumerable && actual.configurable === descriptor.configurable;
                }
            } catch { fault('RESTORE_FAILED'); }
            restoration = { owned, descriptorRestored };
            if (!owned || !descriptorRestored) fault('RESTORE_INCOMPLETE');
            return restoration;
        },
        snapshot() {
            return { schemaVersion: 'mediflow.fixture.official-lock-observation.v1',
                compatibility: { playwright: '1.58.2', sourceHashes: expectedSources, existingConnection: true },
                clocks: { nodeMonotonicMs: 'Node performance.now relative to installation; observation order',
                    cdpTimestampSeconds: 'CDP monotonic seconds; not the Node clock', scriptCoordinates: 'CDP zero based' },
                limits, events: [...events], journalBytes: bytes, dropped, truncated: dropped > 0 || metadataTruncated,
                observerErrors, errorCodes: { ...errorCodes }, contextChanged, contextUnavailable,
                missingInitiators, missingStacks, unavailableParents, omittedScripts, restoration,
                limitsOfInference: ['Minified, missing or bounded stacks may not distinguish callers.',
                    'Cadence and proximity to dispose do not attribute a timer or Playwright teardown.',
                    'Missing parent stacks are not fetched; no additional protocol command is sent.'] };
        },
    };
}
