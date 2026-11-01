import { registerHooks } from 'node:module';
const NETWORK_MODULES = new Set([
    'dgram', 'dns', 'dns/promises', 'http', 'http2', 'https', 'net', 'quic', 'tls', 'undici',
    'node:dgram', 'node:dns', 'node:dns/promises', 'node:http', 'node:http2', 'node:https',
    'node:net', 'node:quic', 'node:tls',
]);

/* @Codex: Node's permission model denies filesystem writes, child processes and
   workers, but does not currently mediate sockets. Keep the child import graph
   network-closed as a second, process-local guard. The native renderer remains
   outside this JavaScript guard and is therefore still bounded by the parent. */
function denyNetwork() {
    const error = new Error('network_disabled');
    error.code = 'MEDIFLOW_NETWORK_DISABLED';
    throw error;
}

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (NETWORK_MODULES.has(specifier)) denyNetwork();
        return nextResolve(specifier, context);
    },
});

const getBuiltinModule = process.getBuiltinModule.bind(process);
Object.defineProperty(process, 'getBuiltinModule', {
    configurable: false,
    enumerable: true,
    writable: false,
    value(specifier) {
        if (NETWORK_MODULES.has(specifier) || NETWORK_MODULES.has(`node:${specifier}`)) denyNetwork();
        return getBuiltinModule(specifier);
    },
});
Object.defineProperty(globalThis, 'fetch', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: async () => denyNetwork(),
});
if ('WebSocket' in globalThis) Object.defineProperty(globalThis, 'WebSocket', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: class NetworkDisabledWebSocket { constructor() { denyNetwork(); } },
});

