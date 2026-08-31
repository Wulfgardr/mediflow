/* @Codex */
import 'server-only';
import { types } from 'node:util';
import {
    abortResourceUse, beginResourceUse, commitResourceUse, mintResourcePort,
    registerPrivateResource, releaseResourcePort, unregisterPrivateResource,
    type WebResourcePort, type WebResourceRegistration, type WebResourceUse,
} from './web-auth-lifecycle-owner-adapter';
const SESSION_KEYS = ['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt'] as const;
const ATTESTATION_KEYS = ['attestationRef', 'actorRef', 'schemaVersion', 'role', 'operationId', 'policyVersion', 'status', 'attestationVersion', 'issuerRef', 'expiresAt', 'activatedAt', 'revocationGeneration', 'revokedAt', 'createdAt', 'updatedAt'] as const;
const ATTESTATION_SCHEMA = 'mediflow.headless-soap-active-role-attestation.v1', OPERATION = 'mediflow.clinical_diary.append_soap.v1', POLICY = 'clinician_confirmed_single_use.v1';
const TTL_MS = 8 * 60 * 60 * 1_000, sessionIdPattern = /^[0-9a-f]{64}$/u, attestationRefPattern = /^hsar_[0-9a-f]{32}$/u, issuerRefPattern = /^hsari_[0-9a-f]{32}$/u;
const objectAssign = Object.assign, objectCreate = Object.create, objectFreeze = Object.freeze, objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors, objectIsFrozen = Object.isFrozen, reflectOwnKeys = Reflect.ownKeys;
const reflectApply = Reflect.apply, regexpExec = RegExp.prototype.exec, stringTrim = String.prototype.trim, numberIsSafeInteger = Number.isSafeInteger, isProxy = types.isProxy;
const datePrototype = Date.prototype, dateGetTime = Date.prototype.getTime, defaultClock = Date.now;
const WeakMapConstructor = WeakMap, MapConstructor = Map, weakMapGet = WeakMap.prototype.get, weakMapSet = WeakMap.prototype.set, weakMapDelete = WeakMap.prototype.delete;
const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapDelete = Map.prototype.delete;
declare const grantIdentity: unique symbol;
export type HeadlessSoapActiveRoleSessionGrantV1 = Readonly<{ readonly [grantIdentity]?: never }>;
export type HeadlessSoapActiveRoleSessionGrantErrorCode = 'session_unavailable' | 'session_ineligible' | 'attestation_unavailable' | 'attestation_inactive' | 'attestation_expired' | 'attestation_revoked' | 'projection_stale' | 'grant_unavailable' | 'lifecycle_unavailable';
export class HeadlessSoapActiveRoleSessionGrantError extends Error {
    constructor(readonly code: HeadlessSoapActiveRoleSessionGrantErrorCode) { super(`Headless SOAP active-role session grant rejected: ${code}`); this.name = 'HeadlessSoapActiveRoleSessionGrantError'; }
}
export type HeadlessSoapActiveRoleSessionGrantSources = Readonly<{
    readCurrentSession(): Promise<unknown>;
    readAttestation(actorRef: string): unknown;
    clock?: () => number;
}>;
type Session = Readonly<{ id: string; userId: string; username: string; role: 'admin'; authChannel: 'web'; createdAt: number; expiresAt: number }>;
type Snapshot = Readonly<{ session: Session; attestationRef: string; issuerRef: string; activatedAt: number; attestationExpiresAt: number; updatedAt: number; expiresAt: number }>;
type GrantRecord = { grant: HeadlessSoapActiveRoleSessionGrantV1; snapshot: Snapshot; active: boolean; port: WebResourcePort | null; registration: WebResourceRegistration | null };
function fail(code: HeadlessSoapActiveRoleSessionGrantErrorCode): never { throw new HeadlessSoapActiveRoleSessionGrantError(code); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || isProxy(value) || objectGetPrototypeOf(value) !== null || !objectIsFrozen(value)) return null;
        const descriptors = objectGetOwnPropertyDescriptors(value), ownKeys = reflectOwnKeys(value);
        if (ownKeys.length !== keys.length || reflectOwnKeys(descriptors).length !== keys.length) return null;
        for (let index = 0; index < keys.length; index += 1) { const key = keys[index]!; const descriptor = descriptors[key]; if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.configurable || descriptor.writable) return null; }
        return value as Record<string, unknown>;
    } catch { return null; }
}
function now(clock: () => number): number { let value: unknown; try { value = clock(); } catch { return fail('session_unavailable'); } return numberIsSafeInteger(value) && (value as number) >= 0 ? value as number : fail('session_unavailable'); }
function session(value: unknown, observedAt: number): Session {
    const row = exact(value, SESSION_KEYS);
    if (!row || typeof row.id !== 'string' || reflectApply(regexpExec, sessionIdPattern, [row.id]) === null
        || typeof row.userId !== 'string' || !row.userId || row.userId !== reflectApply(stringTrim, row.userId, []) || row.userId.length > 256
        || typeof row.username !== 'string' || !row.username || row.username !== reflectApply(stringTrim, row.username, [])
        || row.role !== 'admin' || row.authChannel !== 'web' || !numberIsSafeInteger(row.createdAt) || !numberIsSafeInteger(row.expiresAt)
        || (row.createdAt as number) < 0 || (row.createdAt as number) > observedAt || (row.expiresAt as number) <= observedAt) return fail('session_ineligible');
    return row as unknown as Session;
}
function date(value: unknown): number | null {
    try { if (typeof value !== 'object' || value === null || isProxy(value) || objectGetPrototypeOf(value) !== datePrototype) return null;
        const result = reflectApply(dateGetTime, value, []); return numberIsSafeInteger(result) && result >= 0 ? result : null; } catch { return null; }
}
function attestation(value: unknown, actorRef: string, observedAt: number): Omit<Snapshot, 'session' | 'expiresAt'> {
    const row = exact(value, ATTESTATION_KEYS);
    if (!row || row.actorRef !== actorRef || row.schemaVersion !== ATTESTATION_SCHEMA || row.role !== 'physician' || row.operationId !== OPERATION
        || row.policyVersion !== POLICY || row.attestationVersion !== 1 || typeof row.attestationRef !== 'string'
        || reflectApply(regexpExec, attestationRefPattern, [row.attestationRef]) === null) return fail('attestation_unavailable');
    if (row.status === 'inactive') return fail('attestation_inactive');
    if (row.status === 'revoked') return fail('attestation_revoked');
    const activatedAt = date(row.activatedAt), expiresAt = date(row.expiresAt), createdAt = date(row.createdAt), updatedAt = date(row.updatedAt);
    if (row.status !== 'active' || row.revocationGeneration !== 0 || row.revokedAt !== null || typeof row.issuerRef !== 'string'
        || reflectApply(regexpExec, issuerRefPattern, [row.issuerRef]) === null || activatedAt === null || expiresAt === null || createdAt === null || updatedAt === null) return fail('attestation_unavailable');
    if (expiresAt <= observedAt) return fail('attestation_expired');
    if (activatedAt > observedAt || activatedAt < createdAt || updatedAt < activatedAt || updatedAt > observedAt || expiresAt - activatedAt !== TTL_MS) return fail('attestation_unavailable');
    return objectFreeze(objectAssign(objectCreate(null), { attestationRef: row.attestationRef, issuerRef: row.issuerRef, activatedAt, attestationExpiresAt: expiresAt, updatedAt }));
}
function sameSession(left: Session, right: Session): boolean { for (let index = 0; index < SESSION_KEYS.length; index += 1) { const key = SESSION_KEYS[index]!; if (left[key] !== right[key]) return false; } return true; }
function sameSnapshot(left: Snapshot, right: Snapshot): boolean { return sameSession(left.session, right.session) && left.attestationRef === right.attestationRef
    && left.issuerRef === right.issuerRef && left.activatedAt === right.activatedAt && left.attestationExpiresAt === right.attestationExpiresAt && left.updatedAt === right.updatedAt && left.expiresAt === right.expiresAt; }
function weakGet<T>(registry: WeakMap<object, T>, key: object): T | undefined { return reflectApply(weakMapGet, registry, [key]) as T | undefined; }
function weakSet<T>(registry: WeakMap<object, T>, key: object, value: T): void { reflectApply(weakMapSet, registry, [key, value]); }
function weakDelete<T>(registry: WeakMap<object, T>, key: object): void { reflectApply(weakMapDelete, registry, [key]); }
function currentGet(registry: Map<string, GrantRecord>, key: string): GrantRecord | undefined { return reflectApply(mapGet, registry, [key]) as GrantRecord | undefined; }
function currentSet(registry: Map<string, GrantRecord>, key: string, value: GrantRecord): void { reflectApply(mapSet, registry, [key, value]); }
function currentDelete(registry: Map<string, GrantRecord>, key: string): void { reflectApply(mapDelete, registry, [key]); }
/** Owns one opaque, process-local prerequisite; it contains no patient, proposal, proof, or write authority. */
export function createHeadlessSoapActiveRoleSessionGrantService(sources: HeadlessSoapActiveRoleSessionGrantSources) {
    const issued = new WeakMapConstructor<object, GrantRecord>(), current = new MapConstructor<string, GrantRecord>(), clock = sources.clock ?? defaultClock;
    const discard = (record: GrantRecord, ownerCleanup = false): void => { if (!record.active) return; record.active = false;
        if (currentGet(current, record.snapshot.session.id) === record) currentDelete(current, record.snapshot.session.id); weakDelete(issued, record.grant);
        const port = record.port, registration = record.registration; record.port = null; record.registration = null;
        if (!ownerCleanup) { if (port && registration) unregisterPrivateResource(port, registration); if (port) releaseResourcePort(port); } };
    const capture = (value: unknown): Snapshot => {
        const observedAt = now(clock), activeSession = session(value, observedAt); let stored: unknown;
        try { stored = sources.readAttestation(activeSession.userId); } catch { return fail('attestation_unavailable'); }
        const facts = attestation(stored, activeSession.userId, observedAt);
        const expiresAt = activeSession.expiresAt < facts.attestationExpiresAt ? activeSession.expiresAt : facts.attestationExpiresAt;
        return objectFreeze(objectAssign(objectCreate(null), { session: activeSession }, facts, { expiresAt })) as Snapshot; };
    const read = async (): Promise<Snapshot> => { let value: unknown; try { value = await sources.readCurrentSession(); } catch { return fail('session_unavailable'); } return capture(value); };
    const confirmResource = (record: GrantRecord): boolean => { const port = record.port; if (!record.active || !port) return false; let resourceUse: WebResourceUse | null = null, committed = false;
        try { resourceUse = beginResourceUse(port); committed = !!resourceUse && commitResourceUse(resourceUse); return committed; }
        catch { return false; } finally { if (resourceUse && !committed) abortResourceUse(resourceUse); } };
    return objectFreeze({
        async issue(): Promise<HeadlessSoapActiveRoleSessionGrantV1> {
            const before = await read(); let value: unknown; try { value = await sources.readCurrentSession(); } catch { return fail('session_unavailable'); }
            const snapshot = capture(value); if (!sameSnapshot(before, snapshot)) return fail('projection_stale'); const existing = currentGet(current, snapshot.session.id);
            if (existing && sameSnapshot(existing.snapshot, snapshot) && confirmResource(existing)) return existing.grant;
            if (existing) discard(existing);
            const grant = objectFreeze(objectCreate(null)) as HeadlessSoapActiveRoleSessionGrantV1;
            const record: GrantRecord = { grant, snapshot, active: true, port: null, registration: null };
            let port: WebResourcePort | null = null, registration: WebResourceRegistration | null = null, resourceUse: WebResourceUse | null = null, committed = false;
            try { port = mintResourcePort(snapshot.session); if (!port) return fail('lifecycle_unavailable');
                resourceUse = beginResourceUse(port); if (!resourceUse) return fail('lifecycle_unavailable');
                registration = registerPrivateResource(port, () => { discard(record, true); }); if (!registration) return fail('lifecycle_unavailable');
                committed = commitResourceUse(resourceUse); if (!committed || !record.active) return fail('lifecycle_unavailable');
                record.port = port; record.registration = registration; currentSet(current, snapshot.session.id, record); weakSet(issued, grant, record);
                if (!record.active || currentGet(current, snapshot.session.id) !== record || weakGet(issued, grant) !== record) { discard(record); return fail('lifecycle_unavailable'); }
                return grant;
            } finally { if (resourceUse && !committed) abortResourceUse(resourceUse); if (!committed) { if (port && registration) unregisterPrivateResource(port, registration); if (port) releaseResourcePort(port); record.active = false; } }
        },
        async recheck(candidate: unknown): Promise<HeadlessSoapActiveRoleSessionGrantV1> {
            const record = typeof candidate === 'object' && candidate !== null ? weakGet(issued, candidate) : undefined;
            if (!record || !record.active || now(clock) >= record.snapshot.expiresAt) { if (record) discard(record); return fail('grant_unavailable'); }
            let snapshot: Snapshot; try { const before = await read(); let value: unknown;
                try { value = await sources.readCurrentSession(); } catch { return fail('session_unavailable'); }
                snapshot = capture(value); if (!sameSnapshot(before, snapshot)) return fail('projection_stale'); } catch (error) { discard(record); throw error; }
            if (!record.active || !sameSnapshot(record.snapshot, snapshot)) { discard(record); return fail('projection_stale'); }
            if (!confirmResource(record)) { discard(record); return fail('grant_unavailable'); } return record.grant;
        },
        dispose(candidate: unknown): boolean { const record = typeof candidate === 'object' && candidate !== null ? weakGet(issued, candidate) : undefined;
            if (!record || !record.active) return false; discard(record); return true; },
    });
}
