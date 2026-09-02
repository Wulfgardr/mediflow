/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { types } from 'node:util';

import {
    decodePortableSupervisorWebIpcFrameV1,
    encodePortableSupervisorWebIpcFrameV1,
    type PortableSupervisorWebIpcFrameV1,
} from '../../packages/aip/src/portable-supervisor-web-ipc-contract.ts';

const SCHEMA = 'mediflow.portable-supervisor.web-ipc.v1';
const PREPARE_TIMEOUT_MS = 5_000;
const ACTIVATE_TIMEOUT_MS = 5_000;
const REVOKE_TIMEOUT_MS = 1_000;
const REVOKE_REASONS = new Set(['logout', 'application_lock', 'reselection', 'expiry',
    'web_disconnect', 'mcp_disconnect', 'restart', 'explicit']);

type BridgeErrorCode = 'host_unavailable' | 'protocol_invalid' | 'timeout' | 'denied' | 'context_invalid';
type MessageListener = (message: unknown) => void;
type Sources = Readonly<{
    now(): unknown;
    randomBytes(size: number): unknown;
    connected(): unknown;
    send(frame: string, done: (error: Error | null) => void): unknown;
    onMessage(listener: MessageListener): unknown;
    offMessage(listener: MessageListener): unknown;
    disconnect(): unknown;
    schedule(delayMs: number, callback: () => void): unknown;
}>;
type RevokeReason = 'logout' | 'application_lock' | 'reselection' | 'expiry'
    | 'web_disconnect' | 'mcp_disconnect' | 'restart' | 'explicit';

export class PortableSupervisorWebIpcBridgeV1Error extends Error {
    constructor(public readonly code: BridgeErrorCode, public readonly denialCode: string | null = null) {
        super(`Portable supervisor Web IPC bridge rejected: ${code}`);
        this.name = 'PortableSupervisorWebIpcBridgeV1Error';
    }
}

function fail(code: BridgeErrorCode, denialCode: string | null = null): never {
    throw new PortableSupervisorWebIpcBridgeV1Error(code, denialCode);
}
function record<T extends object>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null) as T, value));
}
function integer(value: unknown, minimum = 0): value is number {
    return Number.isSafeInteger(value) && (value as number) >= minimum;
}
function discardPromise(value: unknown): boolean {
    if (!types.isPromise(value)) return false;
    try { void Promise.prototype.then.call(value, undefined, () => undefined); } catch { /* transport is denied */ }
    return true;
}

export function createPortableSupervisorWebIpcBridgeV1(sources: Sources): Readonly<{
    activate(readCurrentCapture: () => unknown): Promise<Readonly<{ expiresAt: number }>>;
    revokeAll(reason: RevokeReason): Promise<boolean>;
    disconnect(): void;
}> {
    const disconnect = (): void => {
        let isConnected: unknown = true;
        try { isConnected = sources.connected(); } catch { /* still attempt disconnect */ }
        discardPromise(isConnected);
        if (isConnected === false) return;
        try { discardPromise(sources.disconnect()); } catch { /* logical channel is already unavailable */ }
    };
    const hostNow = (): number => {
        let value: unknown;
        try { value = sources.now(); } catch { return fail('host_unavailable'); }
        if (discardPromise(value) || !integer(value)) return fail('host_unavailable');
        return value;
    };
    const connected = (): boolean => {
        let value: unknown;
        try { value = sources.connected(); } catch { return false; }
        return !discardPromise(value) && value === true;
    };
    const requestRef = (): string => {
        let value: unknown;
        try { value = sources.randomBytes(16); } catch { return fail('host_unavailable'); }
        if (discardPromise(value) || !(value instanceof Uint8Array) || types.isProxy(value)
            || value.byteLength !== 16) {
            return fail('host_unavailable');
        }
        return `pswr_${Buffer.from(value as Uint8Array).toString('hex')}`;
    };
    const exchange = (frame: string, expectedRequest: string, expectedOutcome: string,
        timeoutMs: number): Promise<PortableSupervisorWebIpcFrameV1> => {
        if (!connected()) return Promise.reject(new PortableSupervisorWebIpcBridgeV1Error('host_unavailable'));
        return new Promise((resolve, reject) => {
            let settled = false, cancelTimer: (() => void) | null = null;
            const finish = (error: PortableSupervisorWebIpcBridgeV1Error | null,
                value: PortableSupervisorWebIpcFrameV1 | null, sever = false): void => {
                if (settled) return;
                settled = true;
                try { sources.offMessage(listener); } catch { sever = true; }
                const cancel = cancelTimer; cancelTimer = null;
                try { cancel?.(); } catch { sever = true; }
                if (sever) {
                    disconnect();
                    if (!error) error = new PortableSupervisorWebIpcBridgeV1Error('host_unavailable');
                }
                if (error) reject(error); else resolve(value as PortableSupervisorWebIpcFrameV1);
            };
            const listener: MessageListener = (message) => {
                let response: PortableSupervisorWebIpcFrameV1;
                try { response = decodePortableSupervisorWebIpcFrameV1(message); }
                catch { finish(new PortableSupervisorWebIpcBridgeV1Error('protocol_invalid'), null, true); return; }
                if (response.requestRef !== expectedRequest) return;
                if (response.method !== 'ack') {
                    finish(new PortableSupervisorWebIpcBridgeV1Error('protocol_invalid'), null, true); return;
                }
                if (response.outcome === 'denied') {
                    finish(new PortableSupervisorWebIpcBridgeV1Error('denied', response.denialCode as string), null); return;
                }
                if (response.outcome !== expectedOutcome) {
                    finish(new PortableSupervisorWebIpcBridgeV1Error('protocol_invalid'), null, true); return;
                }
                finish(null, response);
            };
            try {
                const subscription = sources.onMessage(listener);
                if (discardPromise(subscription)) {
                    finish(new PortableSupervisorWebIpcBridgeV1Error('host_unavailable'), null, true); return;
                }
            }
            catch { finish(new PortableSupervisorWebIpcBridgeV1Error('host_unavailable'), null, true); return; }
            if (settled) return;
            let scheduling = true, fired = false, timer: unknown;
            try {
                timer = sources.schedule(timeoutMs, () => {
                    if (scheduling) { fired = true; return; }
                    finish(new PortableSupervisorWebIpcBridgeV1Error('timeout'), null, true);
                });
            } catch { finish(new PortableSupervisorWebIpcBridgeV1Error('host_unavailable'), null, true); return; }
            scheduling = false;
            const timerIsPromise = discardPromise(timer);
            if (fired || timerIsPromise || typeof timer !== 'function' || types.isProxy(timer)
                || types.isAsyncFunction(timer)) {
                try { if (typeof timer === 'function') timer(); } catch { /* denied timer */ }
                finish(new PortableSupervisorWebIpcBridgeV1Error(fired ? 'timeout' : 'host_unavailable'), null, true);
                return;
            }
            cancelTimer = timer as () => void;
            try {
                const sent = sources.send(frame, (error) => {
                    if (error) finish(new PortableSupervisorWebIpcBridgeV1Error('host_unavailable'), null, true);
                });
                if (discardPromise(sent)) {
                    finish(new PortableSupervisorWebIpcBridgeV1Error('host_unavailable'), null, true);
                }
            } catch { finish(new PortableSupervisorWebIpcBridgeV1Error('host_unavailable'), null, true); }
        });
    };
    const activate = async (readCurrentCapture: () => unknown): Promise<Readonly<{ expiresAt: number }>> => {
        if (typeof readCurrentCapture !== 'function' || types.isProxy(readCurrentCapture)
            || types.isAsyncFunction(readCurrentCapture)) return fail('context_invalid');
        const startedAt = hostNow(), currentRequest = requestRef();
        const prepareFrame = encodePortableSupervisorWebIpcFrameV1({
            schemaVersion: SCHEMA, method: 'prepare', requestRef: currentRequest,
        });
        const prepared = await exchange(prepareFrame, currentRequest, 'prepared', PREPARE_TIMEOUT_MS);
        const challengedAt = hostNow();
        if (challengedAt < startedAt || !integer(prepared.expiresAt, challengedAt + 1)
            || (prepared.expiresAt as number) > challengedAt + PREPARE_TIMEOUT_MS) {
            disconnect(); return fail('protocol_invalid');
        }
        let captureValue: unknown;
        try { captureValue = readCurrentCapture(); }
        catch { return fail('context_invalid'); }
        if (discardPromise(captureValue)) return fail('context_invalid');
        let activationFrame: string, canonicalActivation: PortableSupervisorWebIpcFrameV1;
        try {
            activationFrame = encodePortableSupervisorWebIpcFrameV1({ schemaVersion: SCHEMA, method: 'activate',
                requestRef: currentRequest, challenge: prepared.challenge, capture: captureValue });
            canonicalActivation = decodePortableSupervisorWebIpcFrameV1(activationFrame);
        } catch { return fail('context_invalid'); }
        const activated = await exchange(activationFrame, currentRequest, 'activated', ACTIVATE_TIMEOUT_MS);
        let completedAt: number;
        try { completedAt = hostNow(); }
        catch (error) { disconnect(); throw error; }
        const captureExpiresAt = (canonicalActivation.capture as Record<string, unknown>).expiresAt;
        if (completedAt < challengedAt || !integer(activated.expiresAt, completedAt + 1)
            || !integer(captureExpiresAt, 1)
            || (activated.expiresAt as number) > captureExpiresAt) {
            disconnect(); return fail('protocol_invalid');
        }
        return record({ expiresAt: activated.expiresAt as number });
    };
    const revokeAll = async (reason: RevokeReason): Promise<boolean> => {
        try {
            if (!REVOKE_REASONS.has(reason)) return fail('protocol_invalid');
            const currentRequest = requestRef();
            const frame = encodePortableSupervisorWebIpcFrameV1({
                schemaVersion: SCHEMA, method: 'revoke_all', requestRef: currentRequest, reason,
            });
            await exchange(frame, currentRequest, 'revoked', REVOKE_TIMEOUT_MS);
        }
        catch (error) { disconnect(); throw error; }
        return true;
    };
    return record({ activate, revokeAll, disconnect });
}

const hostSetTimeout = setTimeout;
const hostClearTimeout = clearTimeout;
const productionBridge = createPortableSupervisorWebIpcBridgeV1({
    now: Date.now,
    randomBytes,
    connected: () => process.connected === true && typeof process.send === 'function',
    send: (frame, done) => {
        if (!process.send) throw new Error('parent IPC unavailable');
        return process.send(frame, undefined, undefined, (error: Error | null) => done(error ?? null));
    },
    onMessage: (listener) => process.on('message', listener),
    offMessage: (listener) => process.off('message', listener),
    disconnect: () => { if (process.connected) process.disconnect(); },
    schedule: (delay, callback) => {
        const timer = hostSetTimeout(callback, delay); timer.unref();
        return () => hostClearTimeout(timer);
    },
});

export const activatePortableSupervisorWebIpcV1 = productionBridge.activate;
export const revokePortableSupervisorWebIpcV1 = productionBridge.revokeAll;
export const disconnectPortableSupervisorWebIpcV1 = productionBridge.disconnect;
