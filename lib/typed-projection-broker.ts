/* @Codex */
import 'server-only';
import { randomBytes } from 'node:crypto';
import { SmartImportProjectionError, snapshotSmartImportProjection, type SmartImportProjection } from './smart-import-projection.ts';

export type ProjectionBrokerErrorCode =
    | 'broker_locked' | 'broker_revoked' | 'capability_mismatch' | 'handle_collision' | 'handle_missing'
    | 'input_invalid' | 'lease_expired' | 'patient_mismatch' | 'projection_invalid' | 'projection_stale'
    | 'request_replayed' | 'selection_changed' | 'source_invalid';
export class ProjectionBrokerError extends Error {
    constructor(readonly code: ProjectionBrokerErrorCode) {
        super(`Projection broker rejected: ${code}`);
        this.name = 'ProjectionBrokerError';
    }
}
export type TypedProjectionBrokerSources = Readonly<{ clock: () => string; entropy: () => Uint8Array }>;
export type TypedProjectionBrokerConfig = Readonly<{
    sessionRef: string;
    ambulatoryRef: string;
    patientRef: string;
    selectionEpoch: number;
    leaseRef: string;
    expiresAt: string;
}>;

function fail(code: ProjectionBrokerErrorCode): never { throw new ProjectionBrokerError(code); }
function exact(value: unknown, keys: readonly string[], code: ProjectionBrokerErrorCode) {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) fail(code);
    const record: Record<string, unknown> = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor)) fail(code);
        record[key] = descriptor.value;
    }
    return record;
}
function opaque(value: unknown, code: ProjectionBrokerErrorCode) {
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u.test(value)) fail(code);
    return value;
}
function positive(value: unknown) {
    if (!Number.isSafeInteger(value) || (value as number) < 1) fail('input_invalid');
    return value as number;
}
function timestamp(value: unknown, code: ProjectionBrokerErrorCode) {
    if (typeof value !== 'string' || value.length > 32 || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(code);
    return value;
}
const productionSources = Object.freeze({ clock: () => new Date().toISOString(), entropy: () => randomBytes(16) });

export function createTypedProjectionBroker(configValue: TypedProjectionBrokerConfig, sourceValue: TypedProjectionBrokerSources = productionSources) {
    const config = exact(configValue, ['sessionRef', 'ambulatoryRef', 'patientRef', 'selectionEpoch', 'leaseRef', 'expiresAt'], 'input_invalid');
    opaque(config.sessionRef, 'input_invalid'); opaque(config.ambulatoryRef, 'input_invalid'); opaque(config.leaseRef, 'input_invalid');
    let patientRef = opaque(config.patientRef, 'input_invalid'); let selectionEpoch = positive(config.selectionEpoch);
    const expiresMs = Date.parse(timestamp(config.expiresAt, 'input_invalid'));
    const sourceRecord = exact(sourceValue, ['clock', 'entropy'], 'source_invalid');
    if (typeof sourceRecord.clock !== 'function' || typeof sourceRecord.entropy !== 'function') fail('source_invalid');
    const clock = sourceRecord.clock as () => string; const entropy = sourceRecord.entropy as () => Uint8Array;
    const records = new Map<string, SmartImportProjection>(); const issued = new Set<string>(); const requests = new Set<string>();
    let locked = false; let revoked = false; let selectionChanged = false;
    const readClock = () => {
        try { return timestamp(clock(), 'source_invalid'); } catch { return fail('source_invalid'); }
    };
    const readHandle = () => {
        try {
            const bytes = entropy();
            if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16) return fail('source_invalid');
            let hex = ''; for (let index = 0; index < 16; index += 1) hex += bytes[index].toString(16).padStart(2, '0');
            return `prj_${hex}`;
        } catch { return fail('source_invalid'); }
    };
    const acceptRequest = (value: unknown) => {
        const requestId = opaque(value, 'input_invalid');
        if (requests.has(requestId)) fail('request_replayed');
        requests.add(requestId);
    };
    const active = () => {
        const now = readClock();
        if (revoked) fail('broker_revoked');
        if (locked) fail('broker_locked');
        if (Date.parse(now) >= expiresMs) { records.clear(); fail('lease_expired'); }
        return now;
    };
    const ingest = Object.freeze({ ingest(inputValue: Readonly<{ projection: SmartImportProjection; requestId: string }>) {
        const input = exact(inputValue, ['projection', 'requestId'], 'input_invalid'); acceptRequest(input.requestId); const now = active();
        let snapshot: SmartImportProjection;
        try { snapshot = snapshotSmartImportProjection(input.projection, now); } catch (error) {
            if (error instanceof SmartImportProjectionError) return fail(error.code);
            return fail('projection_invalid');
        }
        if (snapshot.patientRef !== patientRef) fail('patient_mismatch');
        if (snapshot.selectionEpoch !== selectionEpoch) fail('selection_changed');
        const handle = readHandle();
        if (issued.has(handle)) fail('handle_collision');
        issued.add(handle); records.set(handle, snapshot); selectionChanged = false; return handle;
    } });
    const service = Object.freeze({ consume(inputValue: Readonly<{ handle: string; capability: 'smart_import'; requestId: string }>) {
        const input = exact(inputValue, ['handle', 'capability', 'requestId'], 'input_invalid'); acceptRequest(input.requestId); active();
        if (selectionChanged) fail('selection_changed');
        if (input.capability !== 'smart_import') fail('capability_mismatch');
        if (typeof input.handle !== 'string' || !/^prj_[0-9a-f]{32}$/u.test(input.handle)) fail('input_invalid');
        const snapshot = records.get(input.handle);
        if (!snapshot) fail('handle_missing');
        records.delete(input.handle); return snapshot;
    } });
    const control = Object.freeze({
        lock() { locked = true; records.clear(); },
        revoke() { revoked = true; records.clear(); },
        changeSelection(value: Readonly<{ patientRef: string; selectionEpoch: number }>) {
            const next = exact(value, ['patientRef', 'selectionEpoch'], 'input_invalid'); const nextEpoch = positive(next.selectionEpoch);
            if (nextEpoch <= selectionEpoch) fail('input_invalid');
            patientRef = opaque(next.patientRef, 'input_invalid'); selectionEpoch = nextEpoch; selectionChanged = true; records.clear();
        },
    });
    return Object.freeze({ ingest, service, control });
}
