import { diagnosticOperation } from './diagnostic-operation';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Page } from '@playwright/test';

const expectedVersion = '1.58.2';
const expectedProtocolSources: Record<string, string> = {
    "package.json": "16a25dbd7368a87af8b58a45c6216b9cec5a91a72cf704533344701997ebde22",
    "lib/inProcessFactory.js": "406a2ce0e50bf6c695a0fa018ac3dec505b60836710bbab797e11730c51917cc",
    "lib/client/connection.js": "e063a23c7fb0ed81e7a09baa0844851c660b3cba1c39176963f17b10a1bf1526",
    "lib/client/channelOwner.js": "7052cae26b3fc156572494b9cf8a6cdddc8d3845aea7dec9ef7642f44f866c7e",
    "lib/client/page.js": "409b11561b319e8dfb4d1ec3f8b126fb32ab19e894fae529edbeae57c056ae84",
    "lib/server/page.js": "9cdfc88c5718ddcdc4c8205dabc3cfd68378699d7bef1b5017a28e74eda6b226",
    "lib/server/dispatchers/pageDispatcher.js": "b11d9dd2eb7b0560f95a54cff4aeab9a9b3c76d84d6ae507b396aed2914cb3f4",
    "lib/server/chromium/crConnection.js": "0d41a058ad1f5c897329a9c821c52b952e0e709ab38c3e6e355224b167922f13",
    "lib/server/chromium/crPage.js": "08f14f9abc4bde5b36a0679889de05e8c3c0ebbf7e15c3bafc3639830e01c174",
    "lib/server/chromium/crInput.js": "3dcad19b8f52f3f1f9787c5fff350607e242cd0d0c6911223c9d44bed9a75432"
};

type WireMessage = { id?: number; method?: string; sessionId?: string;
    params?: Record<string, unknown>; error?: { code?: number } };
type ProtocolLogger = (direction: string, message: WireMessage) => void;
type ProtocolConnection = { _protocolLogger: ProtocolLogger };
type ServerPage = { delegate: { _mainFrameSession: { _client: {
    _sessionId: string; _connection: ProtocolConnection } } }; mainFrame(): { _id: string } };
type SendMessage = (this: ClientConnection, object: unknown, method: string,
    params: Record<string, unknown>, options: unknown) => Promise<unknown>;
type ClientConnection = { toImpl(page: Page): ServerPage; sendMessageToServer: SendMessage };
type Mark = 'waiter-call-returned' | 'enter-call' | 'public-filechooser-resolved' | 'native-input-verified' | 'native-input-mismatch';
type Event = { seq: number; timeMs: number; kind: string; [key: string]: unknown };

export function installAnyDocPassiveProtocol(page: Page) {
    return diagnosticOperation('anydoc.install', () => installObservedProtocol(page));
}

function installObservedProtocol(page: Page) {
    const require = createRequire(resolve(process.cwd(), 'package.json'));
    const lock = JSON.parse(readFileSync(resolve(process.cwd(), 'package-lock.json'), 'utf8'));
    const coreRoot = dirname(require.resolve('playwright-core/package.json'));
    const sourceHashes: Record<string, string> = {};
    for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
        const installed = JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')).version;
        if (installed !== expectedVersion || lock.packages[`node_modules/${name}`]?.version !== expectedVersion)
            throw new Error(`ANYDOC_PROTOCOL_PROBE_INCOMPATIBLE: version ${name}`);
    }
    for (const [file, expected] of Object.entries(expectedProtocolSources)) {
        const actual = createHash('sha256').update(readFileSync(join(coreRoot, file))).digest('hex');
        sourceHashes[file] = actual;
        if (actual !== expected) throw new Error(`ANYDOC_PROTOCOL_PROBE_INCOMPATIBLE: source ${file}`);
    }
    const client = (page as unknown as { _connection?: ClientConnection })._connection;
    if (!client || typeof client.toImpl !== 'function' || typeof client.sendMessageToServer !== 'function')
        throw new Error('ANYDOC_PROTOCOL_PROBE_INCOMPATIBLE: local client connection');
    const impl = client.toImpl(page);
    const session = impl?.delegate?._mainFrameSession?._client;
    const protocol = session?._connection;
    if (!session || typeof session._sessionId !== 'string' || !protocol || typeof protocol._protocolLogger !== 'function'
        || typeof impl.mainFrame !== 'function' || typeof impl.mainFrame()._id !== 'string')
        throw new Error('ANYDOC_PROTOCOL_PROBE_INCOMPATIBLE: Chromium main-frame connection');
    const originalLogger = protocol._protocolLogger;
    const originalSend = client.sendMessageToServer;
    const originalLoggerDescriptor = Object.getOwnPropertyDescriptor(protocol, '_protocolLogger');
    const originalSendDescriptor = Object.getOwnPropertyDescriptor(client, 'sendMessageToServer');
    const initialSessionId = session._sessionId;
    const started = performance.now();
    const limit = 256;
    const events: Event[] = [];
    const counts: Record<string, number> = { interceptionEnableSend: 0, interceptionDisableSend: 0,
        enterDispatchSend: 0, enterKeyDownSend: 0, enterKeyUpSend: 0 };
    const pending = new Map<number, { method: string; sessionId: string; enabled?: boolean }>();
    let seq = 0, dropped = 0, observerErrors = 0, subscriptionId = 0;
    let pendingTruncated = false;
    let restoration: { protocolRestored: boolean; subscriptionRestored: boolean } | null = null;
    const record = (kind: string, fields: Record<string, unknown> = {}) => {
        try {
            const event = { seq: ++seq, timeMs: performance.now() - started, kind, ...fields };
            counts[kind] = (counts[kind] ?? 0) + 1;
            if (events.length < limit) events.push(event); else dropped++;
        } catch { observerErrors++; }
    };
    const sessionFields = (id: string) => ({ sameInitialSession: id === initialSessionId,
        sameCurrentMainSession: id === impl.delegate._mainFrameSession._client._sessionId,
        currentMainSessionChanged: impl.delegate._mainFrameSession._client._sessionId !== initialSessionId });
    const logger: ProtocolLogger = function (this: ProtocolConnection, direction, message) {
        try {
            const params = message.params ?? {};
            const id = message.sessionId ?? '';
            if (direction === 'send' && (message.method === 'Page.setInterceptFileChooserDialog'
                || message.method === 'Input.dispatchKeyEvent' && (params.key === 'Enter' || params.code === 'Enter'))) {
                const enabled = typeof params.enabled === 'boolean' ? params.enabled : undefined;
                if (message.method === 'Page.setInterceptFileChooserDialog') {
                    if (enabled === true) counts.interceptionEnableSend++;
                    if (enabled === false) counts.interceptionDisableSend++;
                } else {
                    counts.enterDispatchSend++;
                    if (params.type === 'keyDown' || params.type === 'rawKeyDown') counts.enterKeyDownSend++;
                    if (params.type === 'keyUp') counts.enterKeyUpSend++;
                }
                if (typeof message.id === 'number') {
                    if (pending.size < limit) pending.set(message.id, { method: message.method, sessionId: id, enabled });
                    else pendingTruncated = true;
                }
                record('cdp-send', { id: message.id, method: message.method, ...sessionFields(id),
                    ...(message.method === 'Page.setInterceptFileChooserDialog'
                        ? { enabled, cancel: typeof params.cancel === 'boolean' ? params.cancel : null }
                        : { key: 'Enter', type: params.type, repeat: params.autoRepeat === true }) });
            } else if (direction === 'receive' && typeof message.id === 'number' && pending.has(message.id)) {
                const sent = pending.get(message.id)!;
                pending.delete(message.id);
                record('cdp-response', { id: message.id, method: sent.method, ...sessionFields(id),
                    matchesSendSession: id === sent.sessionId, enabled: sent.enabled,
                    success: !message.error, errorCode: typeof message.error?.code === 'number' ? message.error.code : null });
            } else if (direction === 'receive' && message.method === 'Page.fileChooserOpened') {
                record('cdp-filechooser-opened', { ...sessionFields(id),
                    mainFrame: params.frameId === impl.mainFrame()._id,
                    backendNodeIdPresent: typeof params.backendNodeId === 'number' && params.backendNodeId !== 0 });
            }
        } catch { observerErrors++; }
        return Reflect.apply(originalLogger, this, [direction, message]);
    };
    const send: SendMessage = function (this: ClientConnection, ...args) {
        const [object, method, params] = args;
        if (object !== page || method !== 'updateSubscription' || params.event !== 'fileChooser')
            return Reflect.apply(originalSend, this, args);
        const id = ++subscriptionId;
        const enabled = params.enabled === true;
        record('subscription-start', { id, enabled });
        let result: Promise<unknown>;
        try { result = Reflect.apply(originalSend, this, args); }
        catch (error) { record('subscription-reject', { id, enabled, synchronous: true }); throw error; }
        void result.then(() => record('subscription-resolve', { id, enabled }), () => record('subscription-reject', { id, enabled, synchronous: false }));
        return result;
    };
    protocol._protocolLogger = logger;
    client.sendMessageToServer = send;
    const compatibility = { playwright: expectedVersion, sourceHashes, localInProcessConnection: true,
        existingMainFrameSession: true };
    record('observer-installed');
    return {
        mark: (kind: Mark) => record(kind),
        restore() { return diagnosticOperation('anydoc.restore', () => {
            const ownsProtocol = protocol._protocolLogger === logger;
            const ownsSubscription = client.sendMessageToServer === send;
            if (ownsProtocol) {
                if (originalLoggerDescriptor) Object.defineProperty(protocol, '_protocolLogger', originalLoggerDescriptor);
                else Reflect.deleteProperty(protocol, '_protocolLogger');
            }
            if (ownsSubscription) {
                if (originalSendDescriptor) Object.defineProperty(client, 'sendMessageToServer', originalSendDescriptor);
                else Reflect.deleteProperty(client, 'sendMessageToServer');
            }
            restoration = { protocolRestored: ownsProtocol && protocol._protocolLogger === originalLogger,
                subscriptionRestored: ownsSubscription && client.sendMessageToServer === originalSend };
            record('observer-restored', restoration);
            return restoration;
        }); },
        snapshot() {
            return { schemaVersion: 1, compatibility, clock: 'Node performance.now milliseconds from observer installation',
                events: [...events], counts: { ...counts }, limit, dropped, truncated: dropped > 0 || pendingTruncated,
                pendingCommandCount: pending.size, observerErrors, restoration,
                limits: ['Passive wrappers can perturb timing.', 'Subscription resolution is not proof of a successful CDP acknowledgement.',
                    'Internal adoption and dispatcher forwarding are not separately observed; public delivery is recorded by the original waiter callback.'] };
        },
    };
}
