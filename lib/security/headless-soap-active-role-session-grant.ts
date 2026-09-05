/* @Codex */
import 'server-only';
import { types } from 'node:util';
import {
    abortResourceUse, beginResourceUse, commitResourceUse, mintResourcePort,
    registerPrivateResource, releaseResourcePort, unregisterPrivateResource,
    withCurrentResourceBinding, type WebResourceBinding, type WebResourcePort,
    type WebResourceRegistration, type WebResourceUse,
} from './web-auth-lifecycle-owner-adapter';
import type { HeadlessSoapAuthorizationLineageV1 } from './headless-soap-authorization-lineage';
const SESSION_KEYS = ['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt'] as const;
const ATTESTATION_KEYS = ['attestationRef', 'actorRef', 'schemaVersion', 'role', 'operationId', 'policyVersion', 'status', 'attestationVersion', 'issuerRef', 'expiresAt', 'activatedAt', 'revocationGeneration', 'revokedAt', 'createdAt', 'updatedAt'] as const;
const ATTESTATION_SCHEMA = 'mediflow.headless-soap-active-role-attestation.v1', OPERATION = 'mediflow.clinical_diary.append_soap.v1', POLICY = 'clinician_confirmed_single_use.v1';
const TTL_MS = 8 * 60 * 60 * 1_000, sessionIdPattern = /^[0-9a-f]{64}$/u, attestationRefPattern = /^hsar_[0-9a-f]{32}$/u, issuerRefPattern = /^hsari_[0-9a-f]{32}$/u;
const objectAssign = Object.assign, objectCreate = Object.create, objectFreeze = Object.freeze, objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors, objectIsFrozen = Object.isFrozen, reflectOwnKeys = Reflect.ownKeys;
const reflectApply = Reflect.apply, regexpExec = RegExp.prototype.exec, stringTrim = String.prototype.trim, numberIsSafeInteger = Number.isSafeInteger;
const isAsyncFunction = types.isAsyncFunction, isGeneratorFunction = types.isGeneratorFunction, isPromise = types.isPromise, isProxy = types.isProxy;
const datePrototype = Date.prototype, dateGetTime = Date.prototype.getTime, functionPrototype = Function.prototype, defaultClock = Date.now;
const promiseThen = Promise.prototype.then;
const WeakMapConstructor = WeakMap, MapConstructor = Map, weakMapGet = WeakMap.prototype.get, weakMapSet = WeakMap.prototype.set, weakMapDelete = WeakMap.prototype.delete;
const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapDelete = Map.prototype.delete;
declare const grantIdentity: unique symbol;
declare const dependentRegistrationIdentity: unique symbol;
export type HeadlessSoapActiveRoleSessionGrantV1 = Readonly<{ readonly [grantIdentity]?: never }>;
export type HeadlessSoapActiveRoleDependentRegistrationV1 = Readonly<{ readonly [dependentRegistrationIdentity]?: never }>;
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
type DependentRecord = { registration: HeadlessSoapActiveRoleDependentRegistrationV1; owner: GrantRecord; dispose: () => void; active: boolean; next: DependentRecord | null };
type GrantRecord = { grant: HeadlessSoapActiveRoleSessionGrantV1; snapshot: Snapshot; active: boolean; port: WebResourcePort | null; registration: WebResourceRegistration | null; dependents: DependentRecord | null };
type ActiveRoleBinding = HeadlessSoapAuthorizationLineageV1['activeRole'];
const dependentOperationFailure = objectFreeze(objectCreate(null));
const ignorePromiseRejection = () => undefined;
function requireVoidResult(value: unknown): void { if (value === undefined) return;
    if (isPromise(value)) { try { reflectApply(promiseThen, value, [undefined, ignorePromiseRejection]); } catch { /* the owner is terminalized below */ } }
    throw dependentOperationFailure; }
function synchronousCallback(value: unknown): boolean { return typeof value === 'function' && !isProxy(value) && !isAsyncFunction(value)
    && !isGeneratorFunction(value) && objectGetPrototypeOf(value) === functionPrototype; }
function fieldlessIdentity(value: unknown): boolean { try { return typeof value === 'object' && value !== null && !isProxy(value)
    && objectGetPrototypeOf(value) === null && objectIsFrozen(value) && reflectOwnKeys(value).length === 0; } catch { return false; } }
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
/** Owns the public grant service and its closure-bound dependent lifecycle controller. */
export function createHeadlessSoapActiveRoleSessionGrantOwner(sources: HeadlessSoapActiveRoleSessionGrantSources) {
    const issued = new WeakMapConstructor<object, GrantRecord>(), dependentRegistrations = new WeakMapConstructor<object, DependentRecord>();
    const current = new MapConstructor<string, GrantRecord>(), clock = sources.clock ?? defaultClock; let dependentOperationActive = false, dependentOperationPoisoned = false;
    const unlinkDependent = (dependent: DependentRecord): void => { const owner = dependent.owner;
        if (owner.dependents === dependent) owner.dependents = dependent.next;
        else { let previous = owner.dependents; while (previous && previous.next !== dependent) previous = previous.next; if (previous) previous.next = dependent.next; }
        dependent.next = null; };
    const drainDependents = (record: GrantRecord): void => { let dependent = record.dependents; record.dependents = null;
        while (dependent) { const next = dependent.next; dependent.next = null;
            if (dependent.active) { dependent.active = false; weakDelete(dependentRegistrations, dependent.registration);
                try { reflectApply(dependent.dispose, undefined, []); } catch { /* dependent failure cannot retain siblings */ } }
            dependent = next; } };
    const discard = (record: GrantRecord, ownerCleanup = false): void => { if (!record.active) return; record.active = false;
        if (currentGet(current, record.snapshot.session.id) === record) currentDelete(current, record.snapshot.session.id); weakDelete(issued, record.grant);
        drainDependents(record);
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
    const activeRoleBinding = (record: GrantRecord, value: WebResourceBinding): ActiveRoleBinding | null => {
        const binding = exact(value, ['principalRef', 'authenticationGeneration']);
        if (!binding || binding.principalRef !== record.snapshot.session.userId
            || !fieldlessIdentity(binding.authenticationGeneration)) return null;
        return objectFreeze(objectAssign(objectCreate(null), {
            grantIdentity: record.grant,
            principalRef: binding.principalRef,
            authenticationGeneration: binding.authenticationGeneration,
            actorRef: record.snapshot.session.userId,
            attestationRef: record.snapshot.attestationRef,
            attestationVersion: 1 as const,
            revocationGeneration: 0 as const,
            policyVersion: POLICY,
        })) as ActiveRoleBinding;
    };
    const withResourceBinding = (record: GrantRecord, operation: (binding: ActiveRoleBinding) => void): boolean => {
        const port = record.port; if (!record.active || !port) return false;
        let resourceUse: WebResourceUse | null = null, committed = false, invoked = false;
        try {
            resourceUse = beginResourceUse(port); if (!resourceUse) return false;
            const current = withCurrentResourceBinding(resourceUse, (webBinding) => {
                const binding = activeRoleBinding(record, webBinding); if (!binding) throw dependentOperationFailure;
                requireVoidResult(reflectApply(operation, undefined, [binding])); invoked = true;
            });
            if (!current || !invoked || !record.active) return false;
            committed = commitResourceUse(resourceUse);
            return committed && record.active;
        } catch { return false; }
        finally { if (resourceUse && !committed) abortResourceUse(resourceUse); }
    };
    const finishCurrent = (record: GrantRecord, operation?: (record: GrantRecord) => void): GrantRecord => {
        if (!record.active || currentGet(current, record.snapshot.session.id) !== record || weakGet(issued, record.grant) !== record) { discard(record); return fail('lifecycle_unavailable'); }
        if (operation) { if (dependentOperationActive) { dependentOperationPoisoned = true; discard(record); throw dependentOperationFailure; }
            dependentOperationPoisoned = false; dependentOperationActive = true;
            try { requireVoidResult(reflectApply(operation, undefined, [record])); }
            catch (error) { discard(record); throw error; } finally { dependentOperationActive = false; }
            if (dependentOperationPoisoned || !record.active || currentGet(current, record.snapshot.session.id) !== record || weakGet(issued, record.grant) !== record) { discard(record); throw dependentOperationFailure; } }
        return record; };
    const issueCurrent = async (operation?: (record: GrantRecord) => void): Promise<HeadlessSoapActiveRoleSessionGrantV1> => {
            if (dependentOperationActive) { dependentOperationPoisoned = true; return fail('lifecycle_unavailable'); }
            const before = await read(); let value: unknown; try { value = await sources.readCurrentSession(); } catch { return fail('session_unavailable'); }
            const snapshot = capture(value); if (!sameSnapshot(before, snapshot)) return fail('projection_stale'); const existing = currentGet(current, snapshot.session.id);
            if (existing && sameSnapshot(existing.snapshot, snapshot) && confirmResource(existing)) return finishCurrent(existing, operation).grant;
            if (existing) discard(existing);
            const grant = objectFreeze(objectCreate(null)) as HeadlessSoapActiveRoleSessionGrantV1;
            const record: GrantRecord = { grant, snapshot, active: true, port: null, registration: null, dependents: null };
            let port: WebResourcePort | null = null, registration: WebResourceRegistration | null = null, resourceUse: WebResourceUse | null = null, committed = false;
            try { port = mintResourcePort(snapshot.session); if (!port) return fail('lifecycle_unavailable');
                resourceUse = beginResourceUse(port); if (!resourceUse) return fail('lifecycle_unavailable');
                registration = registerPrivateResource(port, () => { discard(record, true); }); if (!registration) return fail('lifecycle_unavailable');
                committed = commitResourceUse(resourceUse); if (!committed || !record.active) return fail('lifecycle_unavailable');
                record.port = port; record.registration = registration; currentSet(current, snapshot.session.id, record); weakSet(issued, grant, record);
                return finishCurrent(record, operation).grant;
            } finally { if (resourceUse && !committed) abortResourceUse(resourceUse); if (!committed) { if (port && registration) unregisterPrivateResource(port, registration); if (port) releaseResourcePort(port); record.active = false; } }
        };
    const recheckCurrent = async (candidate: unknown, operation?: (record: GrantRecord) => void): Promise<HeadlessSoapActiveRoleSessionGrantV1> => {
            if (dependentOperationActive) { dependentOperationPoisoned = true; return fail('lifecycle_unavailable'); }
            const record = typeof candidate === 'object' && candidate !== null ? weakGet(issued, candidate) : undefined;
            if (!record || !record.active || now(clock) >= record.snapshot.expiresAt) { if (record) discard(record); return fail('grant_unavailable'); }
            let snapshot: Snapshot; try { const before = await read(); let value: unknown;
                try { value = await sources.readCurrentSession(); } catch { return fail('session_unavailable'); }
                snapshot = capture(value); if (!sameSnapshot(before, snapshot)) return fail('projection_stale'); } catch (error) { discard(record); throw error; }
            if (!record.active || !sameSnapshot(record.snapshot, snapshot)) { discard(record); return fail('projection_stale'); }
            if (!confirmResource(record)) { discard(record); return fail('grant_unavailable'); } return finishCurrent(record, operation).grant;
        };
    const registerDependentRecord = (owner: GrantRecord, dispose: () => void): HeadlessSoapActiveRoleDependentRegistrationV1 | null => {
        const registration = objectFreeze(objectCreate(null)) as HeadlessSoapActiveRoleDependentRegistrationV1;
        const dependent: DependentRecord = { registration, owner, dispose, active: true, next: owner.dependents }; owner.dependents = dependent;
        try { weakSet(dependentRegistrations, registration, dependent);
            if (!owner.active || weakGet(issued, owner.grant) !== owner || weakGet(dependentRegistrations, registration) !== dependent) throw dependentOperationFailure;
        } catch { dependent.active = false; try { weakDelete(dependentRegistrations, registration); } catch { /* an unpublished identity cannot retain authority */ }
            unlinkDependent(dependent); discard(owner); return null; }
        return registration; };
    const dependentCurrent = (owner: GrantRecord, registration: unknown): boolean => {
        if (typeof registration !== 'object' || registration === null) return false; const dependent = weakGet(dependentRegistrations, registration);
        return owner.active && !!dependent && dependent.active && dependent.owner === owner && dependent.registration === registration; };
    const service = objectFreeze({
        issue(): Promise<HeadlessSoapActiveRoleSessionGrantV1> { return issueCurrent(); },
        recheck(candidate: unknown): Promise<HeadlessSoapActiveRoleSessionGrantV1> { return recheckCurrent(candidate); },
        dispose(candidate: unknown): boolean { const record = typeof candidate === 'object' && candidate !== null ? weakGet(issued, candidate) : undefined;
            if (!record || !record.active) return false; discard(record); return true; },
    });
    const lifecycleController = objectFreeze({
        async withCurrentGrant(operation: (grant: HeadlessSoapActiveRoleSessionGrantV1) => void): Promise<boolean> {
            if (!synchronousCallback(operation)) return false;
            try { await issueCurrent((owner) => {
                    try { requireVoidResult(reflectApply(operation, undefined, [owner.grant])); } catch { throw dependentOperationFailure; }
                }); return true;
            } catch (error) { if (error === dependentOperationFailure) return false; throw error; }
        },
        registerDependent(candidate: unknown, dispose: () => void): HeadlessSoapActiveRoleDependentRegistrationV1 | null {
            if (typeof candidate !== 'object' || candidate === null || !synchronousCallback(dispose)) return null;
            const owner = weakGet(issued, candidate); if (!owner || !owner.active) return null;
            return registerDependentRecord(owner, dispose);
        },
        confirmDependent(candidate: unknown, registration: unknown): boolean {
            if (typeof candidate !== 'object' || candidate === null) return false; const owner = weakGet(issued, candidate);
            return !!owner && dependentCurrent(owner, registration);
        },
        unregisterDependent(candidate: unknown, registration: unknown): boolean {
            if (typeof candidate !== 'object' || candidate === null || typeof registration !== 'object' || registration === null) return false;
            const owner = weakGet(issued, candidate), dependent = weakGet(dependentRegistrations, registration);
            if (!owner || !dependent || !dependent.active || dependent.owner !== owner || dependent.registration !== registration) return false;
            dependent.active = false; weakDelete(dependentRegistrations, registration); unlinkDependent(dependent); return true;
        },
        async withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void): Promise<boolean> {
            if (typeof candidate !== 'object' || candidate === null || !synchronousCallback(operation)) return false;
            const owner = weakGet(issued, candidate); if (!owner || !dependentCurrent(owner, registration)) return false;
            try { await recheckCurrent(candidate, (currentOwner) => { if (currentOwner !== owner || !dependentCurrent(owner, registration)) throw dependentOperationFailure;
                    try { requireVoidResult(reflectApply(operation, undefined, [])); } catch { throw dependentOperationFailure; }
                    if (!dependentCurrent(owner, registration)) throw dependentOperationFailure; }); return true;
            } catch (error) { if (error === dependentOperationFailure) return false; throw error; }
        },
    });
    const bindingController = objectFreeze({
        async withCurrentGrantBinding(operation: (
            grant: HeadlessSoapActiveRoleSessionGrantV1,
            activeRole: ActiveRoleBinding,
        ) => void): Promise<boolean> {
            if (!synchronousCallback(operation)) return false;
            try {
                await issueCurrent((owner) => {
                    if (!withResourceBinding(owner, (binding) => {
                        requireVoidResult(reflectApply(operation, undefined, [owner.grant, binding]));
                    })) throw dependentOperationFailure;
                });
                return true;
            } catch (error) { if (error === dependentOperationFailure) return false; throw error; }
        },
        async withCurrentDependentBinding(
            candidate: unknown,
            registration: unknown,
            operation: (activeRole: ActiveRoleBinding) => void,
        ): Promise<boolean> {
            if (typeof candidate !== 'object' || candidate === null || !synchronousCallback(operation)) return false;
            const owner = weakGet(issued, candidate);
            if (!owner || !dependentCurrent(owner, registration)) return false;
            try {
                await recheckCurrent(candidate, (currentOwner) => {
                    if (currentOwner !== owner || !dependentCurrent(owner, registration)
                        || !withResourceBinding(owner, (binding) => {
                            requireVoidResult(reflectApply(operation, undefined, [binding]));
                        }) || !dependentCurrent(owner, registration)) throw dependentOperationFailure;
                });
                return true;
            } catch (error) { if (error === dependentOperationFailure) return false; throw error; }
        },
    });
    return objectFreeze({ service, lifecycleController, bindingController });
}

/** Owns one opaque, process-local prerequisite; it contains no downstream authority. */
export function createHeadlessSoapActiveRoleSessionGrantService(sources: HeadlessSoapActiveRoleSessionGrantSources) {
    return createHeadlessSoapActiveRoleSessionGrantOwner(sources).service;
}
