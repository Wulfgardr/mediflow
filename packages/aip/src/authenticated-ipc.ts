/* @Codex */
import { types } from 'node:util';
export const AIP_BOOTSTRAP_ENV_KEY_V1 = 'MEDIFLOW_AIP_BOOTSTRAP_REF' as const;
export const AIP_IPC_MAX_INPUT_BYTES_V1 = 64 * 1024;
export const AIP_IPC_MAX_OUTPUT_BYTES_V1 = 4 * 1024;
export const AIP_IPC_TIMEOUT_MS_V1 = 1_000;
export const AIP_IPC_AUDIT_SCHEMA_V1 = 'mediflow.aip.ipc.audit.v1' as const;
const SOURCE_KEYS = ['broker', 'now', 'nextBootstrapRef', 'hashRef', 'writeAudit', 'authenticateTrustedPortPeer'] as const;
const ACTIVATION_KEYS = ['expectedProcessRef', 'expectedUserRef', 'bootstrapExpiresAt', 'parentRef', 'purposeCode',
    'operation', 'capabilityId', 'scopeDigest', 'maxStage', 'budget', 'expiresAt', 'generation',
    'revocationGeneration', 'selectionEpoch', 'parentGeneration', 'policyGeneration', 'venue', 'egressAllowed'] as const;
const PEER_KEYS = ['transport', 'permission', 'peerRef', 'runtimeRef', 'processRef', 'userRef'] as const;
const FRAME_KEYS = ['schemaVersion', 'operation', 'bootstrapRef'] as const;
const REF = /^[a-z][a-z0-9._-]{15,127}$/u;
const TOKEN = /^[a-z][a-z0-9._-]{0,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const BOOTSTRAP = /^aipb_[0-9a-f]{32}$/u;
const BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype) as object, 'byteLength')?.get;
const RESPONSE = new TextEncoder().encode(JSON.stringify({
    schemaVersion: 'mediflow.aip.bootstrap.result.v1', outcome: 'connected',
}));
export type AipAuthenticatedIpcV1ErrorCode = 'input_invalid' | 'connection_invalid' | 'frame_invalid'
    | 'frame_oversized' | 'peer_denied' | 'permission_denied' | 'identity_mismatch' | 'bootstrap_invalid'
    | 'bootstrap_replay' | 'bootstrap_expired' | 'timeout' | 'cancelled' | 'restart_changed'
    | 'clock_invalid' | 'reference_invalid' | 'audit_failed' | 'broker_failed' | 'output_oversized';
export class AipAuthenticatedIpcV1Error extends Error {
    constructor(public readonly code: AipAuthenticatedIpcV1ErrorCode) {
        super(`AIP authenticated IPC rejected: ${code}`);
        this.name = 'AipAuthenticatedIpcV1Error';
    }
}
type BrokerPort = { issueOwner: (binding: unknown) => unknown; revokeOwner: (owner: unknown) => boolean; restart: () => void };
type Stage = { activation: readonly unknown[]; generation: number; state: 'available' | 'pending' | 'consumed'
    | 'revoked'; denialCode: AipAuthenticatedIpcV1ErrorCode | null };
type Pending = { controller: AbortController; reason: AipAuthenticatedIpcV1ErrorCode };
type Peer = { transport: 'xpc' | 'uds' | 'named_pipe'; peerRef: string; runtimeRef: string };
function exactValues(value: unknown, keys: readonly string[]): unknown[] {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) {
        throw new AipAuthenticatedIpcV1Error('input_invalid');
    }
    let prototype: object | null;
    let ownKeys: (string | symbol)[];
    let descriptors: Record<string, PropertyDescriptor>;
    try {
        prototype = Object.getPrototypeOf(value);
        ownKeys = Reflect.ownKeys(value);
        descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    } catch { throw new AipAuthenticatedIpcV1Error('input_invalid'); }
    if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
        || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
        throw new AipAuthenticatedIpcV1Error('input_invalid');
    }
    return keys.map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor || !('value' in descriptor)) throw new AipAuthenticatedIpcV1Error('input_invalid');
        return descriptor.value;
    });
}
function integer(value: unknown, minimum = 0): value is number { return Number.isSafeInteger(value) && (value as number) >= minimum; }
function brokerPort(value: unknown): BrokerPort {
    if (!value || typeof value !== 'object' || types.isProxy(value)) throw new AipAuthenticatedIpcV1Error('input_invalid');
    let descriptors: Record<string, PropertyDescriptor>;
    try { descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>; }
    catch { throw new AipAuthenticatedIpcV1Error('input_invalid'); }
    const functions = ['issueOwner', 'revokeOwner', 'restart'].map((key) => descriptors[key]);
    if (functions.some((descriptor) => !descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function')) {
        throw new AipAuthenticatedIpcV1Error('input_invalid');
    }
    return value as BrokerPort;
}
function inputBytes(value: unknown): Uint8Array {
    if (types.isProxy(value) || !(value instanceof Uint8Array) || !BYTE_LENGTH_GETTER) {
        throw new AipAuthenticatedIpcV1Error('frame_invalid');
    }
    let length: number;
    try { length = BYTE_LENGTH_GETTER.call(value) as number; }
    catch { throw new AipAuthenticatedIpcV1Error('frame_invalid'); }
    if (length > AIP_IPC_MAX_INPUT_BYTES_V1) throw new AipAuthenticatedIpcV1Error('frame_oversized');
    const copy = new Uint8Array(length);
    try { Uint8Array.prototype.set.call(copy, value); }
    catch { throw new AipAuthenticatedIpcV1Error('frame_invalid'); }
    return copy;
}
function permissionAccepted(transport: unknown, permission: unknown): transport is Peer['transport'] {
    return (transport === 'xpc' && permission === 'per_user')
        || (transport === 'uds' && permission === 'mode_0600_peer_credentials')
        || (transport === 'named_pipe' && permission === 'owner_only_acl');
}
export function createAipChildEnvironmentReplacementV1(bootstrapRef: unknown): Readonly<Record<string, string>> {
    if (typeof bootstrapRef !== 'string' || !BOOTSTRAP.test(bootstrapRef)) {
        throw new AipAuthenticatedIpcV1Error('reference_invalid');
    }
    const environment = Object.create(null) as Record<string, string>;
    environment[AIP_BOOTSTRAP_ENV_KEY_V1] = bootstrapRef;
    return Object.freeze(environment);
}
export function createAipAuthenticatedIpcHostV1(sourcesValue: unknown) {
    let observing = false;
    let reentered = false;
    const enter = (): void => {
        if (observing) {
            reentered = true;
            throw new AipAuthenticatedIpcV1Error('input_invalid');
        }
    };
    const observe = <T>(code: AipAuthenticatedIpcV1ErrorCode, action: () => T): T => {
        enter(); observing = true; reentered = false;
        try {
            let result: T;
            try { result = action(); } catch { throw new AipAuthenticatedIpcV1Error(code); }
            if (reentered) {
                if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => undefined);
                throw new AipAuthenticatedIpcV1Error(code);
            }
            return result;
        } finally { observing = false; reentered = false; }
    };
    const [brokerValue, nowValue, nextRefValue, hashValue, auditValue, authenticateValue] = observe('input_invalid',
        () => exactValues(sourcesValue, SOURCE_KEYS));
    const broker = brokerPort(brokerValue);
    if (typeof nowValue !== 'function' || typeof nextRefValue !== 'function' || typeof hashValue !== 'function'
        || typeof auditValue !== 'function' || typeof authenticateValue !== 'function') {
        throw new AipAuthenticatedIpcV1Error('input_invalid');
    }
    const nowSource = nowValue as () => unknown;
    const nextRefSource = nextRefValue as () => unknown;
    const hashSource = hashValue as (value: string) => unknown;
    const auditSource = auditValue as (record: unknown) => unknown;
    const authenticateTrustedPortPeer = authenticateValue as (connection: object, signal: AbortSignal) => unknown;
    const stages = new Map<string, Stage>();
    const sessions = new Map<object, unknown>();
    const pending = new Map<object, Pending>();
    const closed = new WeakSet<object>();
    let lastNow = -1;
    let generation = 0;
    const now = (): number => {
        const value = observe('clock_invalid', nowSource);
        if (!integer(value) || value < lastNow) throw new AipAuthenticatedIpcV1Error('clock_invalid');
        lastNow = value;
        return value;
    };
    const hash = (value: string): string => {
        const digest = observe('audit_failed', () => hashSource(value));
        if (typeof digest !== 'string' || !DIGEST.test(digest)) throw new AipAuthenticatedIpcV1Error('audit_failed');
        return digest;
    };
    const writeAudit = async (outcome: 'allowed' | 'denied', peer: Peer | null,
        denialCode: AipAuthenticatedIpcV1ErrorCode | null): Promise<void> => {
        const record = Object.freeze({ schemaVersion: AIP_IPC_AUDIT_SCHEMA_V1, eventType: 'bootstrap', outcome,
            transport: peer?.transport ?? null, peerRefHash: peer ? hash(peer.peerRef) : null,
            runtimeRefHash: peer ? hash(peer.runtimeRef) : null, timestamp: now(), denialCode });
        const result = observe('audit_failed', () => auditSource(record));
        if (result !== undefined && !types.isPromise(result)) throw new AipAuthenticatedIpcV1Error('audit_failed');
        if (result !== undefined) {
            const timedOut = new Promise<never>((_resolve, reject) => AbortSignal.timeout(AIP_IPC_TIMEOUT_MS_V1).addEventListener('abort',
                () => reject(new AipAuthenticatedIpcV1Error('audit_failed')), { once: true }));
            try { await Promise.race([result, timedOut]); } catch { throw new AipAuthenticatedIpcV1Error('audit_failed'); }
        }
    };
    const deny = async (code: AipAuthenticatedIpcV1ErrorCode, peer: Peer | null = null): Promise<never> => { await writeAudit('denied', peer, code); throw new AipAuthenticatedIpcV1Error(code); };
    const stageLaunch = (activationValue: unknown): string => {
        enter();
        const activation = Object.freeze(observe('input_invalid', () => exactValues(activationValue, ACTIVATION_KEYS)));
        const [processRef, userRef, bootstrapExpiresAt, parentRef, purposeCode, operation, capabilityId, scopeDigest,
            maxStage, budget, expiresAt, ownerGeneration, revocationGeneration, selectionEpoch, parentGeneration,
            policyGeneration, venue, egressAllowed] = activation;
        const timestamp = now();
        if (![processRef, userRef, parentRef].every((value) => typeof value === 'string' && REF.test(value))
            || ![purposeCode, operation, capabilityId].every((value) => typeof value === 'string' && TOKEN.test(value))
            || typeof scopeDigest !== 'string' || !DIGEST.test(scopeDigest)
            || (maxStage !== 'read_only' && maxStage !== 'proposal_only') || !integer(budget, 1)
            || !integer(bootstrapExpiresAt, timestamp + 1) || !integer(expiresAt, (bootstrapExpiresAt as number) + 1)
            || !integer(ownerGeneration, 1) || !integer(revocationGeneration) || !integer(selectionEpoch)
            || !integer(parentGeneration, 1) || !integer(policyGeneration, 1)
            || venue !== 'local_intelligent_host' || egressAllowed !== false) {
            throw new AipAuthenticatedIpcV1Error('input_invalid');
        }
        const bootstrapRef = observe('reference_invalid', nextRefSource);
        if (typeof bootstrapRef !== 'string' || !BOOTSTRAP.test(bootstrapRef) || stages.has(bootstrapRef)) {
            throw new AipAuthenticatedIpcV1Error('reference_invalid');
        }
        stages.set(bootstrapRef, { activation, generation, state: 'available', denialCode: null });
        return bootstrapRef;
    };
    const handleBootstrap = async (connectionValue: unknown, frameValue: unknown): Promise<Uint8Array> => {
        enter();
        if (!connectionValue || typeof connectionValue !== 'object' || types.isProxy(connectionValue)
            || closed.has(connectionValue as object) || pending.has(connectionValue as object)
            || sessions.has(connectionValue as object)) return deny('connection_invalid');
        let bytes: Uint8Array;
        try { bytes = inputBytes(frameValue); }
        catch (error) { return deny(error instanceof AipAuthenticatedIpcV1Error ? error.code : 'frame_invalid'); }
        let frameValues: unknown[];
        try {
            const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
            frameValues = exactValues(parsed, FRAME_KEYS);
        } catch { return deny('frame_invalid'); }
        const [schemaVersion, operation, bootstrapRef] = frameValues;
        if (schemaVersion !== 'mediflow.aip.bootstrap.v1' || operation !== 'bootstrap'
            || typeof bootstrapRef !== 'string' || !BOOTSTRAP.test(bootstrapRef)) return deny('frame_invalid');
        const stage = stages.get(bootstrapRef);
        if (!stage) return deny('bootstrap_invalid');
        if (stage.state !== 'available') return deny(
            stage.denialCode === 'restart_changed' || stage.denialCode === 'bootstrap_expired'
                ? stage.denialCode : 'bootstrap_replay');
        if (stage.generation !== generation) { stage.state = 'revoked'; stage.denialCode = 'restart_changed'; return deny('restart_changed'); }
        let timestamp: number;
        try { timestamp = now(); } catch { stage.state = 'revoked'; throw new AipAuthenticatedIpcV1Error('clock_invalid'); }
        if (timestamp >= (stage.activation[2] as number)) {
            stage.state = 'revoked'; stage.denialCode = 'bootstrap_expired'; return deny('bootstrap_expired');
        }
        stage.state = 'pending';
        const connection = connectionValue as object;
        const controller = new AbortController();
        const pendingRecord: Pending = { controller, reason: 'cancelled' };
        pending.set(connection, pendingRecord);
        const finishDenied = (code: AipAuthenticatedIpcV1ErrorCode, peer: Peer | null = null): Promise<never> => {
            stage.state = 'revoked'; stage.denialCode = code; pending.delete(connection); return deny(code, peer);
        };
        const timeout = setTimeout(() => { pendingRecord.reason = 'timeout'; controller.abort(); }, AIP_IPC_TIMEOUT_MS_V1);
        let peerValues: unknown[];
        try {
            const result = observe('peer_denied', () => authenticateTrustedPortPeer(connection, controller.signal));
            if (!types.isPromise(result)) throw new AipAuthenticatedIpcV1Error('peer_denied');
            const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort',
                () => reject(new AipAuthenticatedIpcV1Error(pendingRecord.reason)), { once: true }));
            const peerValue = await Promise.race([result, aborted]);
            peerValues = exactValues(peerValue, PEER_KEYS);
        } catch (error) {
            const errorCode = error instanceof AipAuthenticatedIpcV1Error ? error.code : 'peer_denied';
            const denialCode = errorCode === 'cancelled' || errorCode === 'timeout' || errorCode === 'restart_changed'
                ? errorCode : 'peer_denied';
            return finishDenied(denialCode);
        } finally { clearTimeout(timeout); }
        const [transport, permission, peerRef, runtimeRef, processRef, userRef] = peerValues;
        if (!permissionAccepted(transport, permission)) return finishDenied('permission_denied');
        const peer: Peer = { transport, peerRef: peerRef as string, runtimeRef: runtimeRef as string };
        if (![peerRef, runtimeRef, processRef, userRef].every((value) => typeof value === 'string' && REF.test(value))) {
            return finishDenied('peer_denied');
        }
        if (processRef !== stage.activation[0] || userRef !== stage.activation[1]) {
            return finishDenied('identity_mismatch', peer);
        }
        if (stage.generation !== generation) return finishDenied('restart_changed', peer);
        const ownerBinding = Object.freeze(Object.assign(Object.create(null), {
            peerRef, runtimeRef, parentRef: stage.activation[3], purposeCode: stage.activation[4],
            operation: stage.activation[5], capabilityId: stage.activation[6], scopeDigest: stage.activation[7],
            maxStage: stage.activation[8], budget: stage.activation[9], expiresAt: stage.activation[10],
            generation: stage.activation[11], revocationGeneration: stage.activation[12], selectionEpoch: stage.activation[13],
            parentGeneration: stage.activation[14], policyGeneration: stage.activation[15], venue: stage.activation[16],
            egressAllowed: stage.activation[17],
        }));
        let owner: unknown;
        try { owner = observe('broker_failed', () => broker.issueOwner(ownerBinding)); }
        catch { return finishDenied('broker_failed', peer); }
        try { await writeAudit('allowed', peer, null); }
        catch { broker.revokeOwner(owner); stage.state = 'revoked'; stage.denialCode = 'audit_failed';
            pending.delete(connection); throw new AipAuthenticatedIpcV1Error('audit_failed'); }
        if (stage.generation !== generation || closed.has(connection)) {
            broker.revokeOwner(owner);
            return finishDenied(closed.has(connection) ? pendingRecord.reason : 'restart_changed', peer);
        }
        if (RESPONSE.byteLength > AIP_IPC_MAX_OUTPUT_BYTES_V1) {
            broker.revokeOwner(owner); return finishDenied('output_oversized', peer);
        }
        stage.state = 'consumed'; pending.delete(connection); sessions.set(connection, owner);
        return RESPONSE.slice();
    };
    const cancel = (connectionValue: unknown): boolean => {
        enter();
        if (!connectionValue || typeof connectionValue !== 'object' || types.isProxy(connectionValue)) return false;
        const connection = connectionValue as object;
        const active = pending.get(connection);
        const owner = sessions.get(connection);
        if (!active && !owner) return false;
        closed.add(connection);
        if (active) { active.reason = 'cancelled'; active.controller.abort(); }
        if (owner) { broker.revokeOwner(owner); sessions.delete(connection); }
        return true;
    };
    const close = (connectionValue: unknown): boolean => cancel(connectionValue);
    const restart = (): void => {
        enter();
        if (generation >= Number.MAX_SAFE_INTEGER) throw new AipAuthenticatedIpcV1Error('input_invalid');
        generation += 1;
        for (const stage of stages.values()) { stage.state = 'revoked'; stage.denialCode = 'restart_changed'; }
        for (const [connection, active] of pending) {
            closed.add(connection); active.reason = 'restart_changed'; active.controller.abort();
        }
        for (const [connection, owner] of sessions) {
            closed.add(connection); broker.revokeOwner(owner);
        }
        sessions.clear();
        observe('broker_failed', () => broker.restart());
    };
    return Object.freeze({ stageLaunch, handleBootstrap, cancel, close, restart });
}
