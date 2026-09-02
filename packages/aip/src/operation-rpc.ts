/* @Codex */
import { types } from 'node:util';
import { AIP_BOOTSTRAP_ENV_KEY_V1 } from './authenticated-ipc.ts';
export const AIP_OPERATION_RPC_REQUEST_SCHEMA_V1 = 'mediflow.aip.operation.request.v1' as const;
export const AIP_OPERATION_RPC_RESULT_SCHEMA_V1 = 'mediflow.aip.operation.result.v1' as const;
export const AIP_OPERATION_RPC_MAX_FRAME_BYTES_V1 = 64 * 1024;
export const AIP_OPERATION_RPC_MAX_IN_FLIGHT_V1 = 8;
export const AIP_OPERATION_RPC_MAX_REQUESTS_V1 = 256;
export const AIP_OPERATION_RPC_ENV_KEY_V1 = 'MEDIFLOW_AIP_OPERATION_RPC' as const;
export const AIP_OPERATION_RPC_AUTHENTICATED_ENV_V1 = 'authenticated_inherited_child_ipc_v1' as const;
const SOURCE_KEYS = ['operations'] as const;
const DEFINITION_KEYS = ['operationId', 'capabilityId', 'serviceRef', 'maximumStage', 'timeoutMs', 'execute'] as const;
const PORT_KEYS = ['subscribe', 'publish'] as const;
const CATALOG_KEYS = ['schemaVersion', 'method', 'requestId'] as const;
const CALL_KEYS = ['schemaVersion', 'method', 'requestId', 'operationId', 'input'] as const;
const CANCEL_KEYS = ['schemaVersion', 'method', 'requestId', 'targetRequestId'] as const;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u;
const REQUEST = /^rpc_[a-z0-9][a-z0-9_-]{0,63}$/u;
const BOOTSTRAP = /^aipb_[0-9a-f]{32}$/u;
const MAX_OPERATIONS = 32, MAX_JSON_DEPTH = 16, MAX_JSON_VALUES = 2_048;
export type AipOperationRpcV1ErrorCode = 'input_invalid' | 'catalog_invalid' | 'port_invalid';
export class AipOperationRpcV1Error extends Error {
    constructor(public readonly code: AipOperationRpcV1ErrorCode) {
        super(`AIP operation RPC rejected: ${code}`); this.name = 'AipOperationRpcV1Error'; }
}
type Json = null | boolean | number | string | JsonArray | JsonObject;
interface JsonArray { readonly [index: number]: Json; readonly length: number }
interface JsonObject { readonly [key: string]: Json }
type Metadata = Readonly<{ operationId: string; capabilityId: string; serviceRef: string;
    maximumStage: 'read_only' | 'proposal_only' }>;
type Definition = { metadata: Metadata; timeoutMs: number; execute: (input: Json, signal: AbortSignal) => unknown };
type Port = { subscribe: (listener: (frame: unknown) => void) => unknown; publish: (frame: string) => unknown };
type Pending = { controller: AbortController; reason: 'cancelled' | 'timeout' | 'service_failed'; timer: NodeJS.Timeout };
type Session = { generation: number; active: boolean; port: Port; unsubscribe: (() => void) | null;
    pending: Map<string, Pending>; seen: Set<string> };
function exactValues(value: unknown, keys: readonly string[], code: AipOperationRpcV1ErrorCode): unknown[] {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) {
        throw new AipOperationRpcV1Error(code);
    }
    let prototype: object | null;
    let ownKeys: (string | symbol)[];
    let descriptors: Record<string, PropertyDescriptor>;
    try {
        prototype = Object.getPrototypeOf(value);
        ownKeys = Reflect.ownKeys(value);
        descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    } catch { throw new AipOperationRpcV1Error(code); }
    if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
        || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
        throw new AipOperationRpcV1Error(code);
    }
    return keys.map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor || !('value' in descriptor)) throw new AipOperationRpcV1Error(code);
        return descriptor.value;
    });
}
function arrayValues(value: unknown, code: AipOperationRpcV1ErrorCode): unknown[] {
    if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        throw new AipOperationRpcV1Error(code);
    }
    let descriptors: Record<string, PropertyDescriptor>;
    try { descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>; }
    catch { throw new AipOperationRpcV1Error(code); }
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_JSON_VALUES || Reflect.ownKeys(descriptors).length !== length + 1) {
        throw new AipOperationRpcV1Error(code);
    }
    return Array.from({ length }, (_unused, index) => {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor)) throw new AipOperationRpcV1Error(code);
        return descriptor.value;
    });
}
function wellFormed(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (next < 0xdc00 || next > 0xdfff) return false;
            index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) return false;
    }
    return true;
}
function copyJson(value: unknown, budget = { values: 0 }, depth = 0): Json {
    budget.values += 1;
    if (budget.values > MAX_JSON_VALUES || depth > MAX_JSON_DEPTH) throw new Error('invalid_json');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        if (!wellFormed(value) || Buffer.byteLength(value, 'utf8') > AIP_OPERATION_RPC_MAX_FRAME_BYTES_V1) throw new Error('invalid_json');
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('invalid_json');
        return value;
    }
    if (!value || typeof value !== 'object' || types.isProxy(value)) throw new Error('invalid_json');
    if (Array.isArray(value)) {
        const values = arrayValues(value, 'input_invalid');
        return Object.freeze(values.map((item) => copyJson(item, budget, depth + 1)));
    }
    let keys: (string | symbol)[];
    let descriptors: Record<string, PropertyDescriptor>;
    try {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) throw new Error('invalid_json');
        keys = Reflect.ownKeys(value); if (keys.length > MAX_JSON_VALUES) throw new Error('invalid_json');
        descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    } catch { throw new Error('invalid_json'); }
    const output = Object.create(null) as Record<string, Json>;
    for (const key of keys) {
        if (typeof key !== 'string' || !wellFormed(key) || Buffer.byteLength(key, 'utf8') > AIP_OPERATION_RPC_MAX_FRAME_BYTES_V1)
            throw new Error('invalid_json');
        const descriptor = descriptors[key];
        if (!descriptor || !('value' in descriptor)) throw new Error('invalid_json');
        output[key] = copyJson(descriptor.value, budget, depth + 1);
    }
    return Object.freeze(output);
}
function validToken(value: unknown): value is string { return typeof value === 'string' && TOKEN.test(value); }
function validRequest(value: unknown): value is string { return typeof value === 'string' && REQUEST.test(value); }
function ignoreNativePromise(value: unknown): void {
    if (!types.isProxy(value) && types.isPromise(value)) void Promise.prototype.then.call(value, undefined, () => undefined);
}
export function createAipOperationRpcChildEnvironmentV1(bootstrapRef: unknown): Readonly<Record<string, string>> {
    if (typeof bootstrapRef !== 'string' || !BOOTSTRAP.test(bootstrapRef)) throw new AipOperationRpcV1Error('input_invalid');
    const environment = Object.create(null) as Record<string, string>;
    environment[AIP_BOOTSTRAP_ENV_KEY_V1] = bootstrapRef;
    environment[AIP_OPERATION_RPC_ENV_KEY_V1] = 'inherited_child_ipc_v1';
    return Object.freeze(environment);
}
export function createAipAuthenticatedOperationRpcChildEnvironmentV1(
    bootstrapRef: unknown,
): Readonly<Record<string, string>> {
    if (typeof bootstrapRef !== 'string' || !BOOTSTRAP.test(bootstrapRef)) {
        throw new AipOperationRpcV1Error('input_invalid');
    }
    const environment = Object.create(null) as Record<string, string>;
    environment[AIP_BOOTSTRAP_ENV_KEY_V1] = bootstrapRef;
    environment[AIP_OPERATION_RPC_ENV_KEY_V1] = AIP_OPERATION_RPC_AUTHENTICATED_ENV_V1;
    return Object.freeze(environment);
}
export function createAipOperationRpcHostV1(sourcesValue: unknown) {
    const [operationsValue] = exactValues(sourcesValue, SOURCE_KEYS, 'input_invalid');
    const operationValues = arrayValues(operationsValue, 'catalog_invalid');
    if (operationValues.length === 0 || operationValues.length > MAX_OPERATIONS)
        throw new AipOperationRpcV1Error('catalog_invalid');
    const definitions = new Map<string, Definition>();
    for (const value of operationValues) {
        const [operationId, capabilityId, serviceRef, maximumStage, timeoutMs, execute] =
            exactValues(value, DEFINITION_KEYS, 'catalog_invalid');
        if (!validToken(operationId) || !validToken(capabilityId) || !validToken(serviceRef)
            || (maximumStage !== 'read_only' && maximumStage !== 'proposal_only')
            || !Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 1 || (timeoutMs as number) > 30_000
            || typeof execute !== 'function' || types.isProxy(execute) || definitions.has(operationId)) {
            throw new AipOperationRpcV1Error('catalog_invalid');
        }
        const metadata = Object.freeze({ operationId, capabilityId, serviceRef, maximumStage });
        definitions.set(operationId, { metadata, timeoutMs: timeoutMs as number, execute: execute as Definition['execute'] });
    }
    const catalog = Object.freeze([...definitions.values()].map(({ metadata }) => metadata));
    const sessions = new Map<object, Session>();
    let generation = 0;
    const revokeSession = (handle: object, session: Session): void => {
        if (!session.active) return;
        session.active = false;
        sessions.delete(handle);
        for (const pending of session.pending.values()) {
            pending.reason = 'cancelled'; clearTimeout(pending.timer); pending.controller.abort();
        }
        session.pending.clear();
        const unsubscribe = session.unsubscribe;
        session.unsubscribe = null;
        try { ignoreNativePromise(unsubscribe?.()); } catch { /* trusted adapter cleanup is best-effort */ }
    };
    const encode = (payload: unknown, overflowRequestId?: string): string | null => {
        let frame: string;
        try {
            frame = JSON.stringify(copyJson(payload));
            if (Buffer.byteLength(frame, 'utf8') > AIP_OPERATION_RPC_MAX_FRAME_BYTES_V1) throw new Error('oversized');
        } catch {
            if (!overflowRequestId) return null;
            frame = JSON.stringify({ schemaVersion: AIP_OPERATION_RPC_RESULT_SCHEMA_V1,
                requestId: overflowRequestId, outcome: 'denied', denialCode: 'output_oversized' });
        }
        return frame;
    };
    const publish = (handle: object, session: Session, frame: string): void => {
        if (!session.active || session.generation !== generation || sessions.get(handle) !== session) return;
        try {
            const result = session.port.publish(frame);
            ignoreNativePromise(result);
            if (result !== undefined) throw new Error('invalid_publish');
        } catch { revokeSession(handle, session); }
    };
    const send = (handle: object, session: Session, payload: unknown, overflowRequestId?: string): void => {
        if (!session.active || session.generation !== generation || sessions.get(handle) !== session) return;
        const frame = encode(payload, overflowRequestId);
        if (frame === null) { revokeSession(handle, session); return; }
        publish(handle, session, frame);
    };
    const deny = (handle: object, session: Session, requestId: string | null, denialCode: string): void => send(handle,
        session, { schemaVersion: AIP_OPERATION_RPC_RESULT_SCHEMA_V1, requestId, outcome: 'denied', denialCode });
    const runCall = async (handle: object, session: Session, requestId: string, definition: Definition,
        input: Json): Promise<void> => {
        const controller = new AbortController();
        const deadline = performance.now() + definition.timeoutMs;
        const pending: Pending = { controller, reason: 'service_failed', timer: setTimeout(() => {
            pending.reason = 'timeout'; pending.controller.abort();
        }, definition.timeoutMs) };
        session.pending.set(requestId, pending);
        try {
            const result = definition.execute(input, controller.signal);
            const value = !types.isProxy(result) && types.isPromise(result)
                ? await Promise.race([new Promise<unknown>((resolve, reject) => {
                    Promise.prototype.then.call(result, resolve, reject);
                }), new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort',
                    () => reject(new Error('terminal')), { once: true }))])
                : result;
            if (performance.now() >= deadline) { pending.reason = 'timeout'; controller.abort(); throw new Error('terminal'); }
            const output = copyJson(value);
            const frame = encode({ schemaVersion: AIP_OPERATION_RPC_RESULT_SCHEMA_V1, requestId, outcome: 'completed',
                result: { operation: definition.metadata, value: output } }, requestId);
            if (frame === null) throw new Error('terminal');
            if (performance.now() >= deadline) { pending.reason = 'timeout'; controller.abort(); throw new Error('terminal'); }
            if (session.pending.get(requestId) !== pending || !session.active || session.generation !== generation) return;
            session.pending.delete(requestId); clearTimeout(pending.timer);
            publish(handle, session, frame);
        } catch {
            if (session.pending.get(requestId) !== pending || !session.active || session.generation !== generation) return;
            session.pending.delete(requestId); clearTimeout(pending.timer);
            deny(handle, session, requestId, pending.reason);
        }
    };
    const receive = (handle: object, session: Session, frameValue: unknown): void => {
        if (!session.active || session.generation !== generation || sessions.get(handle) !== session) return;
        let frame: unknown;
        try {
            if (typeof frameValue !== 'string' || Buffer.byteLength(frameValue, 'utf8') > AIP_OPERATION_RPC_MAX_FRAME_BYTES_V1) {
                throw new Error('frame_invalid');
            }
            frame = JSON.parse(frameValue) as unknown;
        } catch { deny(handle, session, null, 'frame_invalid'); return; }
        let common: unknown[];
        try {
            const descriptors = Object.getOwnPropertyDescriptors(frame as object) as Record<string, PropertyDescriptor>;
            const method = descriptors.method?.value;
            common = exactValues(frame, method === 'catalog' ? CATALOG_KEYS : method === 'call' ? CALL_KEYS :
                method === 'cancel' ? CANCEL_KEYS : [], 'input_invalid');
        } catch { deny(handle, session, null, 'frame_invalid'); return; }
        const [schemaVersion, method, requestId] = common;
        if (schemaVersion !== AIP_OPERATION_RPC_REQUEST_SCHEMA_V1 || !validRequest(requestId)) {
            deny(handle, session, null, 'frame_invalid'); return;
        }
        if (session.seen.has(requestId)) { deny(handle, session, requestId, 'request_conflict'); return; }
        if (session.seen.size >= AIP_OPERATION_RPC_MAX_REQUESTS_V1) {
            deny(handle, session, requestId, 'request_capacity_exceeded'); return;
        }
        session.seen.add(requestId);
        if (method === 'catalog') {
            send(handle, session, { schemaVersion: AIP_OPERATION_RPC_RESULT_SCHEMA_V1, requestId, outcome: 'completed',
                result: { operations: catalog } });
            return;
        }
        if (method === 'cancel') {
            const targetRequestId = common[3];
            if (!validRequest(targetRequestId)) { deny(handle, session, requestId, 'frame_invalid'); return; }
            const pending = session.pending.get(targetRequestId);
            if (!pending) { deny(handle, session, requestId, 'request_not_active'); return; }
            session.pending.delete(targetRequestId); pending.reason = 'cancelled'; clearTimeout(pending.timer);
            pending.controller.abort();
            send(handle, session, { schemaVersion: AIP_OPERATION_RPC_RESULT_SCHEMA_V1, requestId,
                outcome: 'cancelled', targetRequestId });
            return;
        }
        const operationId = common[3];
        const definition = typeof operationId === 'string' ? definitions.get(operationId) : undefined;
        if (!definition) { deny(handle, session, requestId, 'operation_not_allowed'); return; }
        if (session.pending.size >= AIP_OPERATION_RPC_MAX_IN_FLIGHT_V1) {
            deny(handle, session, requestId, 'in_flight_capacity_exceeded'); return;
        }
        let input: Json;
        try { input = copyJson(common[4]); }
        catch { deny(handle, session, requestId, 'input_invalid'); return; }
        void runCall(handle, session, requestId, definition, input);
    };
    const attach = (portValue: unknown): object => {
        const [subscribe, publish] = exactValues(portValue, PORT_KEYS, 'port_invalid');
        if (typeof subscribe !== 'function' || types.isProxy(subscribe)
            || typeof publish !== 'function' || types.isProxy(publish)) throw new AipOperationRpcV1Error('port_invalid');
        const handle = Object.freeze(Object.create(null)) as object;
        const session: Session = { generation, active: true, port: { subscribe: subscribe as Port['subscribe'],
            publish: publish as Port['publish'] }, unsubscribe: null, pending: new Map(), seen: new Set() };
        sessions.set(handle, session);
        let unsubscribe: unknown;
        try { unsubscribe = session.port.subscribe((frame) => receive(handle, session, frame)); }
        catch { sessions.delete(handle); throw new AipOperationRpcV1Error('port_invalid'); }
        if (typeof unsubscribe !== 'function' || types.isProxy(unsubscribe) || !session.active
            || session.generation !== generation) {
            sessions.delete(handle);
            if (typeof unsubscribe === 'function' && !types.isProxy(unsubscribe)) {
                try { ignoreNativePromise(unsubscribe()); } catch { /* best-effort cleanup */ }
            }
            throw new AipOperationRpcV1Error('port_invalid');
        }
        session.unsubscribe = unsubscribe as () => void;
        return handle;
    };
    const revoke = (handleValue: unknown): boolean => {
        if (!handleValue || typeof handleValue !== 'object' || types.isProxy(handleValue)) return false;
        const session = sessions.get(handleValue as object);
        if (!session) return false;
        revokeSession(handleValue as object, session);
        return true;
    };
    const restart = (): void => {
        if (generation >= Number.MAX_SAFE_INTEGER) throw new AipOperationRpcV1Error('input_invalid');
        generation += 1;
        for (const [handle, session] of [...sessions]) revokeSession(handle, session);
    };
    return Object.freeze({ catalog: () => catalog, attach, revoke, restart });
}
