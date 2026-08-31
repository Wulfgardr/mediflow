/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { createTypedProjectionBroker, ProjectionBrokerError, type TypedProjectionBrokerConfig } from '../typed-projection-broker';
import {
    bindProjectionBrokerToActiveWebSessionResource,
    bindProjectionBrokerToServerSession,
} from './server-session-projection-broker';
import {
    getSession, peekSession, registerServerSessionResource, type ServerSession,
} from './server-session';
import {
    abortResourceUse, beginResourceUse, commitResourceUse, mintResourcePort, releaseResourcePort,
    registerPrivateResource, unregisterPrivateResource,
    type WebResourcePort,
} from './web-auth-lifecycle-owner-adapter';

type TypedBroker = ReturnType<typeof createTypedProjectionBroker>;
type ActiveBinding = {
    selection: SelectionState; active: boolean; control: TypedBroker['control']; unregister: (() => void) | null;
    ingest: TypedBroker['ingest']; service: TypedBroker['service'];
};
type CanonicalPair = Readonly<{ patientId: string; ambulatoryId: string }>;
type SelectionSources = Readonly<{
    resolve(session: ServerSession, input: CanonicalPair): CanonicalPair;
    clock(): number;
    entropy(): Uint8Array;
    brokerFactory(config: TypedProjectionBrokerConfig): TypedBroker;
}>;
type SelectionLease = Readonly<{
    sessionRef: string; selectionEpoch: number; patientRef: string; ambulatoryRef: string;
    leaseRef: string; expiresAt: number;
}>;
type SelectionState = CanonicalPair & SelectionLease;

declare const selectionScopeIdentity: unique symbol;
declare const selectionRegistrationIdentity: unique symbol;
export type ServerSessionSelectionScopeV1 = Readonly<{ readonly [selectionScopeIdentity]?: never }>;
export type ServerSessionSelectionDependentRegistrationV1 = Readonly<{ readonly [selectionRegistrationIdentity]?: never }>;
export type ServerSessionSelectionLifecycleControllerV1 = Readonly<{
    withCurrentSelection(session: ServerSession, operation: (scope: ServerSessionSelectionScopeV1) => void): boolean;
    registerDependent(scope: unknown, dispose: () => void): ServerSessionSelectionDependentRegistrationV1 | null;
    confirmDependent(scope: unknown, registration: unknown): boolean;
    unregisterDependent(scope: unknown, registration: unknown): boolean;
    withCurrentDependent(scope: unknown, registration: unknown, operation: () => void): boolean;
}>;
type SelectionScopeRecord = { scope: ServerSessionSelectionScopeV1; session: ServerSession; selection: SelectionState;
    active: boolean; dependents: SelectionDependentRecord | null; current(): boolean };
type SelectionDependentRecord = { registration: ServerSessionSelectionDependentRegistrationV1; scope: SelectionScopeRecord;
    dispose: () => void; active: boolean; next: SelectionDependentRecord | null; drainNext: SelectionDependentRecord | null;
    port: WebResourcePort | null; resourceRegistration: object | null };

const ObjectCreate = Object.create;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectIsFrozen = Object.isFrozen;
const ObjectDefineProperty = Object.defineProperty;
const ObjectPrototype = Object.prototype;
const ArrayIsArray = Array.isArray;
const NumberIsFinite = Number.isFinite;
const NumberIsSafeInteger = Number.isSafeInteger;
const DateNow = Date.now;
const DateConstructor = Date;
const Uint8ArrayConstructor = Uint8Array;
const dateToISOString = Date.prototype.toISOString;
const numberToString = Number.prototype.toString;
const stringPadStart = String.prototype.padStart;
const WeakSetConstructor = WeakSet;
const WeakMapConstructor = WeakMap;
const MapConstructor = Map;
const SetConstructor = Set;
const authenticOwners = new WeakSetConstructor<object>();
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;
const applyIntrinsic = Reflect.apply;
const ownKeysIntrinsic = Reflect.ownKeys;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapHas = Map.prototype.has;
const mapDelete = Map.prototype.delete;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const setDelete = Set.prototype.delete;
const isProxy = types.isProxy;
const getOwnPropertyDescriptor = ObjectGetOwnPropertyDescriptor;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const weakMapDelete = WeakMap.prototype.delete;
const getPrototypeOf = ObjectGetPrototypeOf;
const FunctionPrototype = Function.prototype;
const PromiseThen = Promise.prototype.then;
const isAsyncFunction = types.isAsyncFunction;
const isGeneratorFunction = types.isGeneratorFunction;
const isPromise = types.isPromise;

function addOwnerIdentity(registry: WeakSet<object>, owner: object): void {
    applyIntrinsic(weakSetAdd, registry, [owner]);
}

function hasOwnerIdentity(registry: WeakSet<object>, candidate: object): boolean {
    return applyIntrinsic(weakSetHas, registry, [candidate]);
}

function getMapValue<K, V>(registry: Map<K, V>, key: K): V | undefined {
    return applyIntrinsic(mapGet, registry, [key]);
}

function setMapValue<K, V>(registry: Map<K, V>, key: K, value: V): void {
    applyIntrinsic(mapSet, registry, [key, value]);
}

function deleteWeakMapValue<K extends object, V>(registry: WeakMap<K, V>, key: K): void {
    applyIntrinsic(weakMapDelete, registry, [key]);
}

function supportedSelectionCallback(value: unknown): value is (...args: never[]) => void {
    return typeof value === 'function' && !isProxy(value) && !isAsyncFunction(value)
        && !isGeneratorFunction(value) && getPrototypeOf(value) === FunctionPrototype;
}

function selectionCallbackSucceeded(operation: (...args: never[]) => void, args: unknown[]): boolean {
    try {
        const result = applyIntrinsic(operation, undefined, args);
        if (result === undefined) return true;
        if (isPromise(result)) {
            try { applyIntrinsic(PromiseThen, result, [undefined, () => undefined]); } catch { /* denial remains local */ }
        }
    } catch { /* fixed false below */ }
    return false;
}

function hasMapValue<K, V>(registry: Map<K, V>, key: K): boolean {
    return applyIntrinsic(mapHas, registry, [key]);
}

function deleteMapValue<K, V>(registry: Map<K, V>, key: K): void {
    applyIntrinsic(mapDelete, registry, [key]);
}

function addSetValue<T>(registry: Set<T>, value: T): void {
    applyIntrinsic(setAdd, registry, [value]);
}

function hasSetValue<T>(registry: Set<T>, value: T): boolean {
    return applyIntrinsic(setHas, registry, [value]);
}

function deleteSetValue<T>(registry: Set<T>, value: T): void {
    applyIntrinsic(setDelete, registry, [value]);
}

type DurableReviewCommitRecord = Readonly<{ spend(): boolean; dispose(): void }>;
const durableReviewCommitPorts = new WeakMapConstructor<object, DurableReviewCommitRecord>();
const authenticDurableReviewCommitPorts = new WeakSetConstructor<object>();

function durableReviewCommitRecord(value: unknown): DurableReviewCommitRecord | null {
    if (typeof value !== 'object' || value === null || isProxy(value)
        || !hasOwnerIdentity(authenticDurableReviewCommitPorts, value)) return null;
    return applyIntrinsic(weakMapGet, durableReviewCommitPorts, [value]) ?? null;
}

export function spendDurableReviewCommitPort(value: unknown): boolean {
    return durableReviewCommitRecord(value)?.spend() ?? false;
}

export function disposeDurableReviewCommitPort(value: unknown): void {
    durableReviewCommitRecord(value)?.dispose();
}

export type ServerSessionProjectionOwnerErrorCode =
    | 'broker_factory_failed' | 'broker_unavailable' | 'epoch_conflict' | 'input_invalid' | 'lease_expired' | 'owner_disposed'
    | 'owner_acquiring' | 'owner_exists' | 'reference_unavailable' | 'selection_busy' | 'selection_unavailable'
    | 'session_ineligible' | 'session_unavailable' | 'stale_selection';

export class ServerSessionProjectionOwnerError extends Error {
    constructor(readonly code: ServerSessionProjectionOwnerErrorCode) {
        super(`Server session projection owner rejected: ${code}`);
        this.name = 'ServerSessionProjectionOwnerError';
    }
}

export type ServerSessionProjectionOwner = Readonly<{
    snapshotSelectionEpoch(session: ServerSession): number;
    snapshotReviewContextEpoch(session: ServerSession): number;
    acquireProjectionIngest(session: ServerSession, input: SelectionLeaseTuple): TypedBroker['ingest'];
    resolveProjectionService(session: ServerSession): TypedBroker['service'];
    issueSelection(input: Readonly<{ expectedEpoch: number; patientId: string; ambulatoryId: string }>): SelectionLease;
    dereferenceSelection(session: ServerSession, input: Readonly<{
        sessionRef: string; selectionEpoch: number; patientRef: string; ambulatoryRef: string; leaseRef: string;
    }>): CanonicalPair;
    mintPatientInsightLeaseCommitPort(session: ServerSession): PatientInsightLeaseCommitPort;
    mintOcrLeaseCommitPort(session: ServerSession): OcrLeaseCommitPort;
    mintDocumentSynthesisLeaseCommitPort(session: ServerSession): DocumentSynthesisLeaseCommitPort;
    mintTreatmentReasoningLeaseCommitPort(session: ServerSession): TreatmentReasoningLeaseCommitPort;
    mintDurableReviewCommitPort(session: ServerSession): DurableReviewCommitPort;
    withLeaseCriticalSection<T>(session: ServerSession, callback: (selection: CanonicalPair) => T): T;
    dispose(): void;
}>;

declare const patientInsightLeaseCommitRef: unique symbol;
declare const ocrLeaseCommitRef: unique symbol;
declare const documentSynthesisLeaseCommitRef: unique symbol;
declare const treatmentReasoningLeaseCommitRef: unique symbol;
declare const durableReviewCommitPortRef: unique symbol;
export type PatientInsightLeaseCommitRef = Readonly<{ readonly [patientInsightLeaseCommitRef]?: never }>;
export type OcrLeaseCommitRef = Readonly<{ readonly [ocrLeaseCommitRef]?: never }>;
export type DocumentSynthesisLeaseCommitRef = Readonly<{ readonly [documentSynthesisLeaseCommitRef]?: never }>;
export type TreatmentReasoningLeaseCommitRef = Readonly<{ readonly [treatmentReasoningLeaseCommitRef]?: never }>;
export type DurableReviewCommitPort = Readonly<{ readonly [durableReviewCommitPortRef]?: never }>;
type LeaseCommitSnapshot<Ref extends object> = Readonly<{
    currentRef: Ref; stagedRef: Ref | null; generation: number; terminal: boolean;
}>;
export type PatientInsightLeaseCommitPort = Readonly<{
    snapshot(): LeaseCommitSnapshot<PatientInsightLeaseCommitRef> | null;
    prepare(input: Readonly<{ expected: PatientInsightLeaseCommitRef }>): PatientInsightLeaseCommitRef | null;
    commit(input: Readonly<{ expected: PatientInsightLeaseCommitRef; replacement: PatientInsightLeaseCommitRef }>): boolean;
    abort(input: Readonly<{ replacement: PatientInsightLeaseCommitRef }>): boolean;
    dispose(): void;
}>;
export type OcrLeaseCommitPort = Readonly<{
    snapshot(): LeaseCommitSnapshot<OcrLeaseCommitRef> | null;
    prepare(input: Readonly<{ expected: OcrLeaseCommitRef }>): OcrLeaseCommitRef | null;
    commit(input: Readonly<{ expected: OcrLeaseCommitRef; replacement: OcrLeaseCommitRef }>): boolean;
    abort(input: Readonly<{ replacement: OcrLeaseCommitRef }>): boolean;
    dispose(): void;
}>;
export type DocumentSynthesisLeaseCommitPort = Readonly<{
    snapshot(): LeaseCommitSnapshot<DocumentSynthesisLeaseCommitRef> | null;
    prepare(input: Readonly<{ expected: DocumentSynthesisLeaseCommitRef }>): DocumentSynthesisLeaseCommitRef | null;
    commit(input: Readonly<{ expected: DocumentSynthesisLeaseCommitRef; replacement: DocumentSynthesisLeaseCommitRef }>): boolean;
    abort(input: Readonly<{ replacement: DocumentSynthesisLeaseCommitRef }>): boolean;
    dispose(): void;
}>;
export type TreatmentReasoningLeaseCommitPort = Readonly<{
    snapshot(): LeaseCommitSnapshot<TreatmentReasoningLeaseCommitRef> | null;
    prepare(input: Readonly<{ expected: TreatmentReasoningLeaseCommitRef }>): TreatmentReasoningLeaseCommitRef | null;
    commit(input: Readonly<{ expected: TreatmentReasoningLeaseCommitRef; replacement: TreatmentReasoningLeaseCommitRef }>): boolean;
    abort(input: Readonly<{ replacement: TreatmentReasoningLeaseCommitRef }>): boolean;
    dispose(): void;
}>;

export type PortServerSessionProjectionOwner = Readonly<{
    snapshotSelectionEpoch(session: ServerSession): number;
    snapshotReviewContextEpoch(session: ServerSession): number;
    issueSelection(input: Readonly<{ expectedEpoch: number; patientId: string; ambulatoryId: string }>): SelectionLease;
    dereferenceSelection(session: ServerSession, input: SelectionLeaseTuple): CanonicalPair;
    mintPatientInsightLeaseCommitPort(session: ServerSession): PatientInsightLeaseCommitPort;
    mintOcrLeaseCommitPort(session: ServerSession): OcrLeaseCommitPort;
    mintDocumentSynthesisLeaseCommitPort(session: ServerSession): DocumentSynthesisLeaseCommitPort;
    mintTreatmentReasoningLeaseCommitPort(session: ServerSession): TreatmentReasoningLeaseCommitPort;
    mintDurableReviewCommitPort(session: ServerSession): DurableReviewCommitPort;
    dispose(): void;
}>;

type ProjectionOwnerSurface = ServerSessionProjectionOwner | PortServerSessionProjectionOwner;
type ProjectionOwnerRegistry<Owner extends ProjectionOwnerSurface> = Readonly<{
    isAuthenticOwner(candidate: unknown): candidate is Owner;
    lookup(sessionId: string): Owner | null;
    snapshotSelectionEpoch(session: ServerSession): number;
    snapshotReviewContextEpoch(session: ServerSession): number;
    acquire(session: ServerSession): Owner;
    create(session: ServerSession): Owner;
}>;

export function isServerSessionProjectionOwner(candidate: unknown): candidate is ServerSessionProjectionOwner {
    if (typeof candidate !== 'object' || candidate === null || isProxy(candidate)) return false;
    return hasOwnerIdentity(authenticOwners, candidate);
}

type SelectionLeaseTuple = Readonly<{ sessionRef: string; selectionEpoch: number; patientRef: string;
    ambulatoryRef: string; leaseRef: string }>;

function fail(code: ServerSessionProjectionOwnerErrorCode): never {
    throw new ServerSessionProjectionOwnerError(code);
}

function revoke(binding: ActiveBinding | null, unregister = true): void {
    if (!binding) return;
    binding.active = false;
    if (unregister) binding.unregister?.();
    binding.unregister = null;
    try { binding.control.revoke(); } catch { /* Authority remains removed and cleanup detail stays opaque. */ }
}

const defaultSources: SelectionSources = ObjectFreeze({
    resolve: () => fail('selection_unavailable'),
    clock: () => DateNow(),
    entropy: () => randomBytes(16),
    brokerFactory: (config) => createTypedProjectionBroker(config),
});

function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
    if (typeof input !== 'object' || input === null || ArrayIsArray(input)
        || getPrototypeOf(input) !== ObjectPrototype || ownKeysIntrinsic(input).length !== keys.length) {
        return fail('input_invalid');
    }
    const result: Record<string, unknown> = {};
    for (let index = 0; index < keys.length; index += 1) {
        const descriptor = getOwnPropertyDescriptor(input, keys[index]);
        if (!descriptor || !('value' in descriptor)) return fail('input_invalid');
        result[keys[index]] = descriptor.value;
    }
    return result;
}

function frozenExact(input: unknown, keys: readonly string[]): Record<string, unknown> | null {
    if (typeof input !== 'object' || input === null || isProxy(input)) return null;
    try {
        if (ArrayIsArray(input) || !ObjectIsFrozen(input) || getPrototypeOf(input) !== ObjectPrototype
            || ownKeysIntrinsic(input).length !== keys.length) return null;
        const result: Record<string, unknown> = ObjectCreate(null);
        for (let index = 0; index < keys.length; index += 1) {
            const descriptor = getOwnPropertyDescriptor(input, keys[index]);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            result[keys[index]] = descriptor.value;
        }
        return result;
    } catch { return null; }
}

type ProjectionOwnerAuthorityKind = 'legacy' | 'port' | 'port-full';

function createProjectionOwnerProcessOwner<Owner extends ProjectionOwnerSurface>(authorityKind: ProjectionOwnerAuthorityKind,
    sourceOverrides: Partial<SelectionSources> = {}): Readonly<{
        registry: ProjectionOwnerRegistry<Owner>; selectionLifecycleController: ServerSessionSelectionLifecycleControllerV1;
    }> {
    const sources = ObjectFreeze({ ...defaultSources, ...sourceOverrides });
    const owners = new MapConstructor<string, ProjectionOwnerSurface>();
    const registryOwners = new WeakSetConstructor<object>();
    const retired = new SetConstructor<string>();
    const acquiring = new SetConstructor<string>();
    let portRevealActive = false;
    const portBacked = authorityKind !== 'legacy';
    const selectionScopes = new WeakMapConstructor<object, SelectionScopeRecord>();
    const sessionScopes = new WeakMapConstructor<object, SelectionScopeRecord>();
    const selectionRegistrations = new WeakMapConstructor<object, SelectionDependentRecord>();
    let selectionOperation: { scope: SelectionScopeRecord; dependent: SelectionDependentRecord | null;
        created: SelectionDependentRecord | null; poisoned: boolean } | null = null;
    const scopeRecord = (candidate: unknown): SelectionScopeRecord | null => typeof candidate === 'object' && candidate !== null
        && !isProxy(candidate) ? applyIntrinsic(weakMapGet, selectionScopes, [candidate]) ?? null : null;
    const dependentRecord = (candidate: unknown): SelectionDependentRecord | null => typeof candidate === 'object' && candidate !== null
        && !isProxy(candidate) ? applyIntrinsic(weakMapGet, selectionRegistrations, [candidate]) ?? null : null;
    const unlinkSelectionDependent = (record: SelectionDependentRecord) => {
        const scope = record.scope;
        if (scope.dependents === record) scope.dependents = record.next;
        else { let previous = scope.dependents; while (previous && previous.next !== record) previous = previous.next;
            if (previous) previous.next = record.next; }
        record.next = null;
    };
    const finishSelectionDependent = (record: SelectionDependentRecord, invoke: boolean, retirement: boolean) => {
        if (!record.active) return;
        record.active = false; deleteWeakMapValue(selectionRegistrations, record.registration); unlinkSelectionDependent(record);
        const port = record.port; const resourceRegistration = record.resourceRegistration;
        record.port = null; record.resourceRegistration = null;
        if (!retirement) {
            if (port && resourceRegistration) { try { unregisterPrivateResource(port, resourceRegistration); } catch { /* local denial remains */ } }
            if (port) { try { releaseResourcePort(port); } catch { /* local denial remains */ } }
        }
        if (invoke) { try { applyIntrinsic(record.dispose, undefined, []); } catch { /* sibling cleanup continues */ } }
    };
    const drainSelectionScope = (scope: SelectionScopeRecord, retirement = false) => {
        if (!scope.active) return;
        scope.active = false; deleteWeakMapValue(selectionScopes, scope.scope);
        if (applyIntrinsic(weakMapGet, sessionScopes, [scope.session]) === scope) deleteWeakMapValue(sessionScopes, scope.session);
        let record = scope.dependents; let pending: SelectionDependentRecord | null = null; scope.dependents = null;
        while (record) { const next = record.next; record.next = null; record.drainNext = pending; pending = record;
            record.active = false; deleteWeakMapValue(selectionRegistrations, record.registration); record = next; }
        while (pending) { const next = pending.drainNext; pending.drainNext = null;
            const port = pending.port; const resourceRegistration = pending.resourceRegistration;
            pending.port = null; pending.resourceRegistration = null;
            if (!retirement) {
                if (port && resourceRegistration) { try { unregisterPrivateResource(port, resourceRegistration); } catch { /* drain continues */ } }
                if (port) { try { releaseResourcePort(port); } catch { /* drain continues */ } }
            }
            try { applyIntrinsic(pending.dispose, undefined, []); } catch { /* drain continues */ }
            pending = next; }
    };
    const beginSelectionOperation = (scope: SelectionScopeRecord, dependent: SelectionDependentRecord | null) => {
        if (selectionOperation) { selectionOperation.poisoned = true; return null; }
        selectionOperation = { scope, dependent, created: null, poisoned: false }; return selectionOperation;
    };
    const endSelectionOperation = (operation: NonNullable<typeof selectionOperation>, success: boolean) => {
        const accepted = success && !operation.poisoned; selectionOperation = null;
        if (!accepted) {
            if (operation.dependent) finishSelectionDependent(operation.dependent, true, false);
            else if (operation.created) finishSelectionDependent(operation.created, true, false);
        }
        return accepted;
    };
    const selectionLifecycleController: ServerSessionSelectionLifecycleControllerV1 = ObjectFreeze({
        withCurrentSelection(presented: ServerSession, operation: (scope: ServerSessionSelectionScopeV1) => void): boolean {
            if (selectionOperation) { selectionOperation.poisoned = true; return false; }
            if (!supportedSelectionCallback(operation)) return false;
            const scope = typeof presented === 'object' && presented !== null && !isProxy(presented)
                ? applyIntrinsic(weakMapGet, sessionScopes, [presented]) ?? null : null;
            if (!scope || !scope.active || !scope.current()) return false;
            const activeOperation = beginSelectionOperation(scope, null); if (!activeOperation) return false;
            const succeeded = selectionCallbackSucceeded(operation, [scope.scope]) && scope.active && scope.current()
                && (!activeOperation.created || activeOperation.created.active);
            return endSelectionOperation(activeOperation, succeeded);
        },
        registerDependent(candidate: unknown, dispose: () => void): ServerSessionSelectionDependentRegistrationV1 | null {
            const scope = scopeRecord(candidate);
            if (!scope || !scope.active || !supportedSelectionCallback(dispose)
                || (selectionOperation && selectionOperation.scope !== scope)) {
                if (selectionOperation) selectionOperation.poisoned = true; return null;
            }
            if (selectionOperation?.dependent || selectionOperation?.created || !scope.current()) {
                if (selectionOperation) selectionOperation.poisoned = true; return null;
            }
            const port = mintResourcePort(scope.session); if (!port) return null;
            const registration = ObjectFreeze(ObjectCreate(null)) as ServerSessionSelectionDependentRegistrationV1;
            const record: SelectionDependentRecord = { registration, scope, dispose, active: true, next: scope.dependents,
                drainNext: null, port, resourceRegistration: null };
            const resourceRegistration = registerPrivateResource(port, () => drainSelectionScope(scope, true));
            if (!resourceRegistration) { releaseResourcePort(port); return null; }
            record.resourceRegistration = resourceRegistration; scope.dependents = record;
            applyIntrinsic(weakMapSet, selectionRegistrations, [registration, record]);
            if (!scope.active || !scope.current()) { finishSelectionDependent(record, false, false); return null; }
            if (selectionOperation) selectionOperation.created = record;
            return registration;
        },
        confirmDependent(candidate: unknown, registration: unknown): boolean {
            const scope = scopeRecord(candidate); const record = dependentRecord(registration);
            return !!scope && !!record && scope.active && record.active && record.scope === scope
                && record.registration === registration && scope.current();
        },
        unregisterDependent(candidate: unknown, registration: unknown): boolean {
            const scope = scopeRecord(candidate); const record = dependentRecord(registration);
            if (!scope || !record || !record.active || record.scope !== scope || record.registration !== registration) return false;
            finishSelectionDependent(record, false, false); return true;
        },
        withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void): boolean {
            if (selectionOperation) { selectionOperation.poisoned = true; return false; }
            if (!supportedSelectionCallback(operation)) return false;
            const scope = scopeRecord(candidate); const record = dependentRecord(registration);
            if (!scope || !record || !scope.active || !record.active || record.scope !== scope
                || record.registration !== registration || !scope.current()) return false;
            const activeOperation = beginSelectionOperation(scope, record); if (!activeOperation) return false;
            const succeeded = selectionCallbackSucceeded(operation, []) && scope.active && record.active
                && dependentRecord(registration) === record && scope.current();
            return endSelectionOperation(activeOperation, succeeded);
        },
    });
    type PortRegistryNode = { owner: ProjectionOwnerSurface; authority: WebResourcePort;
        previous: PortRegistryNode | null; next: PortRegistryNode | null; active: boolean };
    let portRegistryHead: PortRegistryNode | null = null;
    const findPortNode = (candidate: object): PortRegistryNode | null => {
        let node = portRegistryHead;
        while (node) { if (node.active && node.owner === candidate) return node; node = node.next; }
        return null;
    };
    const unlinkPortNode = (node: PortRegistryNode | null) => {
        if (!node?.active) return;
        node.active = false;
        if (node.previous) node.previous.next = node.next;
        else if (portRegistryHead === node) portRegistryHead = node.next;
        if (node.next) node.next.previous = node.previous;
        node.previous = null; node.next = null;
    };
    const currentPortNode = (node: PortRegistryNode): boolean => {
        let current = false;
        let use: ReturnType<typeof beginResourceUse> = null;
        try {
            use = beginResourceUse(node.authority);
            current = use !== null && commitResourceUse(use);
        } catch { /* fail closed below */ }
        if (!current && use) { try { abortResourceUse(use); } catch { /* cleanup continues */ } }
        if (current) return true;
        try { node.owner.dispose(); } catch { /* Public authority remains denied. */ }
        unlinkPortNode(node);
        return false;
    };

    const eligible = (session: ServerSession, renew: boolean) => {
        if (authorityKind === 'legacy') {
            return session.authChannel === 'web' && session.id !== 'local-api'
                && (renew ? getSession(session.id) : peekSession(session.id)) === session;
        }
        let port: WebResourcePort | null = null;
        let use: ReturnType<typeof beginResourceUse> = null;
        let current = false;
        try {
            if (isProxy(session)) return false;
            port = mintResourcePort(session);
            if (!port) return false;
            use = beginResourceUse(port);
            current = use !== null && commitResourceUse(use);
            if (!current && use) abortResourceUse(use);
            return current && session.authChannel === 'web' && session.id !== 'local-api';
        } catch { return false; }
        finally { if (port) releaseResourcePort(port); }
    };

    const registry: ProjectionOwnerRegistry<Owner> = {
        isAuthenticOwner(candidate: unknown): candidate is Owner {
            if (typeof candidate !== 'object' || candidate === null || isProxy(candidate)) return false;
            if (portBacked) {
                const node = findPortNode(candidate);
                return node ? currentPortNode(node) : false;
            }
            return hasOwnerIdentity(registryOwners, candidate);
        },
        lookup(sessionId: string): Owner | null {
            if (portRevealActive) return null;
            const value = (getMapValue(owners, sessionId) as Owner | undefined) ?? null;
            if (!portBacked || !value) return value;
            const node = findPortNode(value);
            return node && currentPortNode(node) ? value : null;
        },
        snapshotSelectionEpoch(session: ServerSession): number {
            if (portRevealActive || !eligible(session, false)) return fail('session_ineligible');
            return getMapValue(owners, session.id)?.snapshotSelectionEpoch(session) ?? 0;
        },
        snapshotReviewContextEpoch(session: ServerSession): number {
            if (portRevealActive || !eligible(session, false)) return fail('session_ineligible');
            return getMapValue(owners, session.id)?.snapshotReviewContextEpoch(session) ?? 0;
        },
        acquire(session: ServerSession): Owner {
            if (portRevealActive || !eligible(session, true)) return fail('session_ineligible');
            const existing = getMapValue(owners, session.id);
            if (existing) return existing as Owner;
            return registry.create(session);
        },
        create(session: ServerSession): Owner {
            if (portRevealActive || !eligible(session, true)) return fail('session_ineligible');
            if (hasMapValue(owners, session.id)) return fail('owner_exists');
            if (hasSetValue(retired, session.id)) return fail('owner_disposed');
            if (hasSetValue(acquiring, session.id)) return fail('owner_acquiring');
            addSetValue(acquiring, session.id);
            let acquisitionCleared = false;
            try {

            let active: ActiveBinding | null = null;
            let epoch = 0;
            let reviewContextEpoch = 0;
            let selection: SelectionState | null = null;
            let selectionLifecycleScope: SelectionScopeRecord | null = null;
            let selecting = false;
            let leaseCriticalSectionActive = false;
            let leasePortOperationActive = false;
            let leasePortOperationPoisoned = false;
            let durableReviewOperationActive = false;
            let durableReviewOperationPoisoned = false;
            let durableReviewCommitInFlight: object | null = null;
            let creating: SelectionState | null = null;
            let terminal = false;
            let unregisterOwner: (() => void) | null = null;
            let authorityPort: WebResourcePort | null = null;
            let publishedOwner: ProjectionOwnerSurface | null = null;
            let registryNode: PortRegistryNode | null = null;
            const currentSession = (renew: boolean) => {
                if (authorityKind === 'legacy') return (renew ? getSession(session.id) : peekSession(session.id)) === session ? session : null;
                try {
                    if (!authorityPort) { finish(true); return null; }
                    const use = beginResourceUse(authorityPort);
                    if (!use) { finish(true); return null; }
                    if (commitResourceUse(use)) return session;
                } catch { /* terminal cleanup below */ }
                finish(true); return null;
            };
            const presentedProjectionIsCurrent = (presented: ServerSession) => {
                if (authorityKind === 'legacy') {
                    return presented === session && session.authChannel === 'web' && currentSession(true) === session;
                }
                let port: WebResourcePort | null = null;
                let use: ReturnType<typeof beginResourceUse> = null;
                let current = false;
                try {
                    if (terminal || isProxy(presented)) return false;
                    port = mintResourcePort(presented);
                    if (!port) return false;
                    use = beginResourceUse(port);
                    current = use !== null && commitResourceUse(use);
                    if (!current && use) abortResourceUse(use);
                    return current && presented.id === session.id && presented.authChannel === 'web'
                        && currentSession(true) === session;
                } catch { return false; }
                finally { if (port) releaseResourcePort(port); }
            };
            const finish = (revokeActive: boolean) => {
                if (terminal) return;
                terminal = true;
                const previousSelectionScope = selectionLifecycleScope; selectionLifecycleScope = null;
                if (previousSelectionScope) drainSelectionScope(previousSelectionScope);
                try { addSetValue(retired, session.id); } catch { /* Terminal state remains authoritative. */ }
                unlinkPortNode(registryNode); registryNode = null;
                try { deleteMapValue(owners, session.id); } catch { /* Applied deletion stays authoritative. */ }
                try { unregisterOwner?.(); } catch { /* Terminal state remains authoritative. */ }
                unregisterOwner = null;
                authorityPort = null;
                publishedOwner = null;
                const previous = active;
                active = null;
                selection = null;
                durableReviewCommitInFlight = null;
                reviewContextEpoch += 1;
                if (previous && revokeActive) revoke(previous);
                else if (previous) { previous.active = false; previous.unregister = null; }
            };
            const issuedRefs = new SetConstructor<string>();
            const patientInsightRefs = new WeakSetConstructor<object>();
            const ocrRefs = new WeakSetConstructor<object>();
            const documentSynthesisRefs = new WeakSetConstructor<object>();
            const treatmentReasoningRefs = new WeakSetConstructor<object>();
            const patientInsightPorts = new WeakSetConstructor<object>();
            const ocrPorts = new WeakSetConstructor<object>();
            const documentSynthesisPorts = new WeakSetConstructor<object>();
            const treatmentReasoningPorts = new WeakSetConstructor<object>();
            const reference = (prefix: string) => {
                let bytes: Uint8Array;
                try { bytes = sources.entropy(); } catch { return fail('reference_unavailable'); }
                if (!(bytes instanceof Uint8ArrayConstructor) || bytes.byteLength < 16) return fail('reference_unavailable');
                let hex = ''; for (let index = 0; index < 16; index += 1) {
                    hex += applyIntrinsic(stringPadStart, applyIntrinsic(numberToString, bytes[index], [16]), [2, '0']);
                }
                const value = `${prefix}_${hex}`;
                if (hasSetValue(issuedRefs, value)) return fail('reference_unavailable');
                addSetValue(issuedRefs, value); return value;
            };
            const sessionRef = reference('ssr');
            const readClock = () => {
                try { const now = sources.clock(); if (NumberIsFinite(now)) return now; } catch { /* fixed error below */ }
                if (portBacked) finish(true);
                return fail('selection_unavailable');
            };
            const requireCurrentSession = (presented: ServerSession) => {
                if (terminal || !presentedProjectionIsCurrent(presented)) fail('session_unavailable');
            };
            const readTuple = (input: unknown) => exact(input, ['sessionRef', 'selectionEpoch', 'patientRef', 'ambulatoryRef', 'leaseRef']) as SelectionLeaseTuple;
            const tupleMatches = (value: SelectionLeaseTuple, current: SelectionState) =>
                value.sessionRef === sessionRef && value.selectionEpoch === current.selectionEpoch
                && value.patientRef === current.patientRef && value.ambulatoryRef === current.ambulatoryRef
                && value.leaseRef === current.leaseRef;
            const expire = () => {
                if (portBacked) { finish(true); return; }
                const previousSelectionScope = selectionLifecycleScope; selectionLifecycleScope = null;
                if (previousSelectionScope) drainSelectionScope(previousSelectionScope);
                const previous = active; const hadSelection = selection !== null;
                active = null; selection = null;
                if (hadSelection) reviewContextEpoch += 1;
                revoke(previous);
            };
            const rejectLeaseCriticalSectionReentry = () => {
                if (leaseCriticalSectionActive) fail('selection_busy');
            };
            const beginLeasePortOperation = () => {
                if (leasePortOperationActive) { leasePortOperationPoisoned = true; return false; }
                leasePortOperationActive = true;
                leasePortOperationPoisoned = false;
                return true;
            };
            const endLeasePortOperation = () => { leasePortOperationActive = false; };
            const rejectDurableReviewReentry = () => {
                if (!durableReviewOperationActive) return false;
                durableReviewOperationPoisoned = true;
                return true;
            };
            const mintLeaseCommitPort = <Ref extends object>(presentedSession: ServerSession,
                refs: WeakSet<object>, ports: WeakSet<object>) => {
                rejectLeaseCriticalSectionReentry();
                requireCurrentSession(presentedSession);
                const boundSelection = selection;
                const boundSelectionEpoch = epoch;
                const boundReviewContextEpoch = reviewContextEpoch;
                if (!boundSelection) return fail('stale_selection');
                if (readClock() >= boundSelection.expiresAt) { expire(); return fail('lease_expired'); }
                requireCurrentSession(presentedSession);
                if (selection !== boundSelection || epoch !== boundSelectionEpoch || reviewContextEpoch !== boundReviewContextEpoch) {
                    return fail('stale_selection');
                }
                const mintRef = (): Ref => {
                    const ref = ObjectFreeze(ObjectCreate(null));
                    addOwnerIdentity(refs, ref);
                    return ref as Ref;
                };
                let ownerState: LeaseCommitSnapshot<Ref> = ObjectFreeze({ currentRef: mintRef(), stagedRef: null as Ref | null, generation: 0, terminal: false });
                let portActive = false;
                let portReentered = false;
                const current = () => {
                    if (terminal || selection !== boundSelection || epoch !== boundSelectionEpoch
                        || reviewContextEpoch !== boundReviewContextEpoch || !presentedProjectionIsCurrent(presentedSession)) return false;
                    let now: number;
                    try {
                        now = sources.clock();
                    } catch { if (portBacked) finish(true); return false; }
                    if (!NumberIsFinite(now) || now >= boundSelection.expiresAt) { expire(); return false; }
                    return NumberIsFinite(now) && now < boundSelection.expiresAt && !terminal
                        && presentedProjectionIsCurrent(presentedSession)
                        && selection === boundSelection && epoch === boundSelectionEpoch && reviewContextEpoch === boundReviewContextEpoch;
                };
                const owns = (candidate: unknown): candidate is Ref =>
                    typeof candidate === 'object' && candidate !== null && !isProxy(candidate) && hasOwnerIdentity(refs, candidate);
                const port = ObjectFreeze({
                    snapshot() {
                        if (portActive) { portReentered = true; return null; }
                        if (!beginLeasePortOperation()) return null;
                        portActive = true;
                        portReentered = false;
                        try {
                            if (!current() || portReentered || leasePortOperationPoisoned) return null;
                            return ObjectFreeze({ currentRef: ownerState.currentRef, stagedRef: ownerState.stagedRef,
                                generation: ownerState.generation, terminal: ownerState.terminal });
                        } finally { portActive = false; endLeasePortOperation(); }
                    },
                    prepare(input: unknown) {
                        if (portActive) { portReentered = true; return null; }
                        if (ownerState.terminal) return null;
                        if (!beginLeasePortOperation()) return null;
                        portActive = true;
                        portReentered = false;
                        try {
                            const request = frozenExact(input, ['expected']);
                            if (!request || !current() || portReentered || leasePortOperationPoisoned || ownerState.terminal
                                || !owns(request.expected) || request.expected !== ownerState.currentRef || ownerState.stagedRef !== null) return null;
                            const replacement = mintRef();
                            ownerState = ObjectFreeze({ currentRef: ownerState.currentRef, stagedRef: replacement,
                                generation: ownerState.generation, terminal: false });
                            return replacement;
                        } finally {
                            portActive = false;
                            endLeasePortOperation();
                        }
                    },
                    commit(input: unknown) {
                        if (portActive) { portReentered = true; return false; }
                        if (ownerState.terminal) return false;
                        if (!beginLeasePortOperation()) return false;
                        portActive = true;
                        portReentered = false;
                        try {
                            const request = frozenExact(input, ['expected', 'replacement']);
                            if (!request || !current() || portReentered || leasePortOperationPoisoned || ownerState.terminal
                                || !owns(request.expected) || !owns(request.replacement) || request.expected !== ownerState.currentRef
                                || request.replacement !== ownerState.stagedRef) return false;
                            ownerState = ObjectFreeze({ currentRef: request.replacement as Ref, stagedRef: null as Ref | null,
                                generation: ownerState.generation + 1, terminal: true });
                            return true;
                        } finally {
                            portActive = false;
                            endLeasePortOperation();
                        }
                    },
                    abort(input: unknown) {
                        if (portActive) { portReentered = true; return false; }
                        if (ownerState.terminal) return false;
                        if (!beginLeasePortOperation()) return false;
                        portActive = true;
                        portReentered = false;
                        try {
                            const request = frozenExact(input, ['replacement']);
                            if (!request || !current() || portReentered || leasePortOperationPoisoned || ownerState.terminal
                                || !owns(request.replacement) || request.replacement !== ownerState.stagedRef) return false;
                            ownerState = ObjectFreeze({ currentRef: ownerState.currentRef, stagedRef: null as Ref | null,
                                generation: ownerState.generation, terminal: true });
                            return true;
                        } finally {
                            portActive = false;
                            endLeasePortOperation();
                        }
                    },
                    dispose() {
                        const outer = !portActive;
                        if (!outer) portReentered = true;
                        else if (!beginLeasePortOperation()) return;
                        if (ownerState.terminal) { if (outer) endLeasePortOperation(); return; }
                        try {
                            if (!leasePortOperationPoisoned) ownerState = ObjectFreeze({ currentRef: ownerState.currentRef,
                                stagedRef: null as Ref | null, generation: ownerState.generation, terminal: true });
                        } finally { if (outer) endLeasePortOperation(); }
                    },
                });
                addOwnerIdentity(ports, port);
                return port;
            };
            const mintDurableReviewCommitPort = (presentedSession: ServerSession): DurableReviewCommitPort => {
                if (!beginLeasePortOperation()) return fail('selection_busy');
                try {
                    if (rejectDurableReviewReentry()) return fail('selection_busy');
                    rejectLeaseCriticalSectionReentry();
                    requireCurrentSession(presentedSession);
                    const boundSelection = selection;
                    const boundSelectionEpoch = epoch;
                    const boundReviewContextEpoch = reviewContextEpoch;
                    if (!boundSelection || durableReviewCommitInFlight !== null) return fail('stale_selection');
                    durableReviewOperationActive = true;
                    durableReviewOperationPoisoned = false;
                    if (readClock() >= boundSelection.expiresAt) { expire(); return fail('lease_expired'); }
                    requireCurrentSession(presentedSession);
                    if (leasePortOperationPoisoned || durableReviewOperationPoisoned || selection !== boundSelection || epoch !== boundSelectionEpoch
                        || reviewContextEpoch !== boundReviewContextEpoch || durableReviewCommitInFlight !== null) return fail('stale_selection');
                    const token = ObjectFreeze(ObjectCreate(null));
                    let spent = false;
                    let disposed = false;
                    const current = () => {
                        if (leasePortOperationPoisoned || durableReviewOperationPoisoned || terminal || disposed || durableReviewCommitInFlight !== token
                            || selection !== boundSelection || !presentedProjectionIsCurrent(presentedSession)
                            || epoch !== boundSelectionEpoch || reviewContextEpoch !== boundReviewContextEpoch) return false;
                        let now: number;
                        try { now = sources.clock(); } catch { if (portBacked) finish(true); return false; }
                        if (!NumberIsFinite(now) || now >= boundSelection.expiresAt) { expire(); return false; }
                        return !leasePortOperationPoisoned && !durableReviewOperationPoisoned && NumberIsFinite(now) && now < boundSelection.expiresAt
                            && !terminal && presentedProjectionIsCurrent(presentedSession)
                            && selection === boundSelection && epoch === boundSelectionEpoch
                            && reviewContextEpoch === boundReviewContextEpoch && durableReviewCommitInFlight === token;
                    };
                    const record: DurableReviewCommitRecord = ObjectFreeze({
                        spend() {
                            if (!beginLeasePortOperation()) return false;
                            if (rejectDurableReviewReentry() || spent || disposed) { endLeasePortOperation(); return false; }
                            durableReviewOperationActive = true;
                            durableReviewOperationPoisoned = false;
                            spent = true;
                            try { return !leasePortOperationPoisoned && current(); }
                            finally { durableReviewOperationActive = false; endLeasePortOperation(); }
                        },
                        dispose() {
                            if (!beginLeasePortOperation()) return;
                            if (rejectDurableReviewReentry()) { endLeasePortOperation(); return; }
                            try {
                                if (!leasePortOperationPoisoned) {
                                    disposed = true;
                                    if (durableReviewCommitInFlight === token) durableReviewCommitInFlight = null;
                                }
                            } finally { endLeasePortOperation(); }
                        },
                    });
                    durableReviewCommitInFlight = token;
                    addOwnerIdentity(authenticDurableReviewCommitPorts, token);
                    applyIntrinsic(weakMapSet, durableReviewCommitPorts, [token, record]);
                    return token as DurableReviewCommitPort;
                } finally { durableReviewOperationActive = false; endLeasePortOperation(); }
            };
            const candidateControl = (candidate: unknown): TypedBroker['control'] | null => {
                if (typeof candidate !== 'object' || candidate === null) return null;
                const descriptor = getOwnPropertyDescriptor(candidate, 'control');
                if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'object' || !descriptor.value) return null;
                return typeof descriptor.value.revoke === 'function' ? descriptor.value as TypedBroker['control'] : null;
            };
            const validCandidate = (candidate: unknown): candidate is TypedBroker => {
                if (typeof candidate !== 'object' || candidate === null) return false;
                const value = candidate as Partial<TypedBroker>;
                return typeof value.ingest?.ingest === 'function' && typeof value.service?.consume === 'function'
                    && typeof value.control?.lock === 'function' && typeof value.control.revoke === 'function'
                    && typeof value.control.changeSelection === 'function';
            };
            const owner: Omit<ServerSessionProjectionOwner, 'mintPatientInsightLeaseCommitPort' | 'mintOcrLeaseCommitPort' | 'mintDocumentSynthesisLeaseCommitPort' | 'mintTreatmentReasoningLeaseCommitPort' | 'mintDurableReviewCommitPort'> = {
                snapshotSelectionEpoch(presentedSession) {
                    requireCurrentSession(presentedSession);
                    return epoch;
                },
                snapshotReviewContextEpoch(presentedSession) {
                    requireCurrentSession(presentedSession);
                    return reviewContextEpoch;
                },
                acquireProjectionIngest(presentedSession, input) {
                    rejectLeaseCriticalSectionReentry();
                    requireCurrentSession(presentedSession);
                    if (authorityKind === 'port') return fail('broker_unavailable');
                    const value = readTuple(input); const current = selection;
                    if (!current || !tupleMatches(value, current)) return fail('stale_selection');
                    if (readClock() >= current.expiresAt) { expire(); return fail('lease_expired'); }
                    if (active?.selection === current && active.active) return active.ingest;
                    if (creating === current) return fail('broker_unavailable');
                    creating = current;
                    let candidate: unknown;
                    try {
                        candidate = sources.brokerFactory({ sessionRef: current.sessionRef, ambulatoryRef: current.ambulatoryRef,
                            patientRef: current.patientRef, selectionEpoch: current.selectionEpoch, leaseRef: current.leaseRef,
                            expiresAt: applyIntrinsic(dateToISOString, new DateConstructor(current.expiresAt), []) });
                    } catch { creating = null; return fail('broker_factory_failed'); }
                    creating = null;
                    try { if (!validCandidate(candidate)) throw new Error('malformed'); }
                    catch {
                        try { candidateControl(candidate)?.revoke(); } catch { /* Opaque cleanup failure. */ }
                        return fail('broker_factory_failed');
                    }
                    try {
                        requireCurrentSession(presentedSession);
                        if (selection !== current || !tupleMatches(value, current)) fail('stale_selection');
                        if (readClock() >= current.expiresAt) { expire(); fail('lease_expired'); }
                    } catch (error) {
                        try { candidate.control.revoke(); } catch { /* Opaque cleanup failure. */ }
                        throw error;
                    }
                    const binding = { selection: current, active: false, control: candidate.control,
                        unregister: null } as ActiveBinding;
                    const assertActive = () => {
                        if (!binding.active || active !== binding || selection !== current) {
                            throw new ProjectionBrokerError('broker_revoked');
                        }
                    };
                    binding.ingest = ObjectFreeze({ ingest(value) { assertActive(); return candidate.ingest.ingest(value); } });
                    binding.service = ObjectFreeze({ consume(value) { assertActive(); return candidate.service.consume(value); } });
                    try {
                        if (portBacked) {
                            const brokerPort = mintResourcePort(presentedSession);
                            if (!brokerPort) return fail('session_unavailable');
                            binding.unregister = bindProjectionBrokerToActiveWebSessionResource(brokerPort, candidate.control);
                        } else {
                            binding.unregister = bindProjectionBrokerToServerSession(session.id, candidate.control);
                        }
                    }
                    catch { return fail('session_unavailable'); }
                    binding.active = true; active = binding;
                    return binding.ingest;
                },
                resolveProjectionService(presentedSession) {
                    rejectLeaseCriticalSectionReentry();
                    requireCurrentSession(presentedSession);
                    if (!selection) return fail('stale_selection');
                    if (readClock() >= selection.expiresAt) { expire(); return fail('lease_expired'); }
                    if (!active?.active || active.selection !== selection) return fail('broker_unavailable');
                    return active.service;
                },
                issueSelection(input) {
                    rejectLeaseCriticalSectionReentry();
                    if (terminal) return fail('session_unavailable');
                    if (selecting) return fail('selection_busy');
                    selecting = true;
                    try {
                        const value = exact(input, ['expectedEpoch', 'patientId', 'ambulatoryId']);
                        if (!NumberIsSafeInteger(value.expectedEpoch) || (value.expectedEpoch as number) < 0
                            || typeof value.patientId !== 'string' || typeof value.ambulatoryId !== 'string') fail('input_invalid');
                        const live = currentSession(true);
                        if (session.authChannel !== 'web' || live !== session) fail('session_unavailable');
                        let pair: CanonicalPair;
                        try { pair = sources.resolve(session, { patientId: value.patientId, ambulatoryId: value.ambulatoryId }); }
                        catch { return fail('selection_unavailable'); }
                        const assertCurrent = () => {
                            const current = currentSession(true);
                            if (terminal || current !== session || session.authChannel !== 'web'
                                || getMapValue(owners, session.id) !== publishedOwner) {
                                return fail('session_unavailable');
                            }
                            if (value.expectedEpoch !== epoch) return fail('epoch_conflict');
                            return current;
                        };
                        assertCurrent();
                        const patientRef = reference('ptr'); const ambulatoryRef = reference('abr'); const leaseRef = reference('lsr');
                        const now = readClock(); const finalSession = assertCurrent(); const expiresAt = finalSession.expiresAt;
                        if (now >= expiresAt) { if (portBacked) expire(); fail('lease_expired'); }
                        const next: SelectionState = ObjectFreeze({ ...pair, sessionRef, selectionEpoch: epoch + 1,
                            patientRef, ambulatoryRef, leaseRef,
                            expiresAt });
                        const previousSelectionScope = selectionLifecycleScope; selectionLifecycleScope = null;
                        if (previousSelectionScope) drainSelectionScope(previousSelectionScope);
                        assertCurrent();
                        const previous = active; active = null; revoke(previous);
                        reviewContextEpoch += 1;
                        epoch = next.selectionEpoch; selection = next;
                        const scopeIdentity = ObjectFreeze(ObjectCreate(null)) as ServerSessionSelectionScopeV1;
                        const scope: SelectionScopeRecord = { scope: scopeIdentity, session, selection: next, active: true, dependents: null,
                            current: () => {
                                if (!scope.active || terminal || selectionLifecycleScope !== scope || selection !== next || epoch !== next.selectionEpoch) return false;
                                try {
                                    const observedAt = readClock();
                                    if (observedAt >= next.expiresAt) { expire(); return false; }
                                    return scope.active && !terminal && currentSession(true) === session
                                        && selectionLifecycleScope === scope && selection === next && epoch === next.selectionEpoch;
                                } catch { return false; }
                            } };
                        selectionLifecycleScope = scope;
                        applyIntrinsic(weakMapSet, selectionScopes, [scopeIdentity, scope]);
                        applyIntrinsic(weakMapSet, sessionScopes, [session, scope]);
                        return ObjectFreeze({ sessionRef, selectionEpoch: next.selectionEpoch, patientRef: next.patientRef,
                            ambulatoryRef: next.ambulatoryRef, leaseRef: next.leaseRef, expiresAt });
                    } finally { selecting = false; }
                },
                dereferenceSelection(presentedSession, input) {
                    rejectLeaseCriticalSectionReentry();
                    const value = exact(input, ['sessionRef', 'selectionEpoch', 'patientRef', 'ambulatoryRef', 'leaseRef']);
                    if (terminal) return fail('session_unavailable');
                    if (!selection) return fail('stale_selection');
                    if (readClock() >= selection.expiresAt) {
                        expire(); return fail('lease_expired');
                    }
                    requireCurrentSession(presentedSession);
                    if (value.sessionRef !== sessionRef || value.selectionEpoch !== selection.selectionEpoch
                        || value.patientRef !== selection.patientRef || value.ambulatoryRef !== selection.ambulatoryRef
                        || value.leaseRef !== selection.leaseRef) fail('stale_selection');
                    return ObjectFreeze({ patientId: selection.patientId, ambulatoryId: selection.ambulatoryId });
                },
                withLeaseCriticalSection(presentedSession, callback) {
                    if (leaseCriticalSectionActive) return fail('selection_busy');
                    if (typeof callback !== 'function') return fail('input_invalid');
                    requireCurrentSession(presentedSession);
                    const current = selection;
                    if (!current) return fail('stale_selection');
                    if (readClock() >= current.expiresAt) { expire(); return fail('lease_expired'); }
                    const expectedSelectionEpoch = epoch;
                    const expectedReviewContextEpoch = reviewContextEpoch;
                    const assertUnchanged = () => {
                        const now = readClock();
                        requireCurrentSession(presentedSession);
                        if (selection !== current || epoch !== expectedSelectionEpoch || reviewContextEpoch !== expectedReviewContextEpoch) {
                            return fail('stale_selection');
                        }
                        if (now >= current.expiresAt) { expire(); return fail('lease_expired'); }
                    };
                    leaseCriticalSectionActive = true;
                    try {
                        let result: unknown;
                        try {
                            result = callback(ObjectFreeze({ patientId: current.patientId, ambulatoryId: current.ambulatoryId }));
                        } catch (error) {
                            assertUnchanged();
                            throw error;
                        }
                        assertUnchanged();
                        let thenable = false;
                        try {
                            thenable = result !== null && (typeof result === 'object' || typeof result === 'function')
                                && typeof (result as { then?: unknown }).then === 'function';
                        } catch { return fail('input_invalid'); }
                        assertUnchanged();
                        if (thenable) return fail('input_invalid');
                        return result as never;
                    } finally { leaseCriticalSectionActive = false; }
                },
                dispose() { rejectLeaseCriticalSectionReentry(); finish(true); },
            };
            ObjectDefineProperty(owner, 'mintPatientInsightLeaseCommitPort', { enumerable: false, value(presentedSession: ServerSession) {
                if (this !== owner) return fail('session_unavailable');
                if (rejectDurableReviewReentry()) return fail('selection_busy');
                return mintLeaseCommitPort<PatientInsightLeaseCommitRef>(presentedSession, patientInsightRefs, patientInsightPorts) as PatientInsightLeaseCommitPort;
            } });
            ObjectDefineProperty(owner, 'mintOcrLeaseCommitPort', { enumerable: false, value(presentedSession: ServerSession) {
                if (this !== owner) return fail('session_unavailable');
                if (rejectDurableReviewReentry()) return fail('selection_busy');
                return mintLeaseCommitPort<OcrLeaseCommitRef>(presentedSession, ocrRefs, ocrPorts) as OcrLeaseCommitPort;
            } });
            ObjectDefineProperty(owner, 'mintDocumentSynthesisLeaseCommitPort', { enumerable: false, value(presentedSession: ServerSession) {
                if (this !== owner) return fail('session_unavailable');
                if (rejectDurableReviewReentry()) return fail('selection_busy');
                return mintLeaseCommitPort<DocumentSynthesisLeaseCommitRef>(presentedSession, documentSynthesisRefs, documentSynthesisPorts) as DocumentSynthesisLeaseCommitPort;
            } });
            ObjectDefineProperty(owner, 'mintTreatmentReasoningLeaseCommitPort', { enumerable: false, value(presentedSession: ServerSession) {
                if (this !== owner) return fail('session_unavailable');
                if (rejectDurableReviewReentry()) return fail('selection_busy');
                return mintLeaseCommitPort<TreatmentReasoningLeaseCommitRef>(presentedSession, treatmentReasoningRefs, treatmentReasoningPorts) as TreatmentReasoningLeaseCommitPort;
            } });
            ObjectDefineProperty(owner, 'mintDurableReviewCommitPort', { enumerable: false, value(presentedSession: ServerSession) {
                if (this !== owner) return fail('session_unavailable');
                return mintDurableReviewCommitPort(presentedSession);
            } });
            const completedOwner = ObjectFreeze(owner) as unknown as ServerSessionProjectionOwner;

            const portOwner = ObjectCreate(null) as PortServerSessionProjectionOwner;
            ObjectDefineProperty(portOwner, 'snapshotSelectionEpoch', { value: function(presentedSession: ServerSession) {
                if (this !== portOwner) return fail('session_unavailable');
                return completedOwner.snapshotSelectionEpoch(presentedSession);
            } });
            ObjectDefineProperty(portOwner, 'snapshotReviewContextEpoch', { value: function(presentedSession: ServerSession) {
                if (this !== portOwner) return fail('session_unavailable');
                return completedOwner.snapshotReviewContextEpoch(presentedSession);
            } });
            ObjectDefineProperty(portOwner, 'issueSelection', { value: function(input: Parameters<PortServerSessionProjectionOwner['issueSelection']>[0]) {
                if (this !== portOwner) return fail('session_unavailable');
                return completedOwner.issueSelection(input);
            } });
            ObjectDefineProperty(portOwner, 'dereferenceSelection', { value: function(presentedSession: ServerSession, input: SelectionLeaseTuple) {
                if (this !== portOwner) return fail('session_unavailable');
                return completedOwner.dereferenceSelection(presentedSession, input);
            } });
            ObjectDefineProperty(portOwner, 'mintPatientInsightLeaseCommitPort', { value: function(presentedSession: ServerSession) {
                if (this !== portOwner) return fail('session_unavailable');
                return completedOwner.mintPatientInsightLeaseCommitPort(presentedSession);
            } });
            ObjectDefineProperty(portOwner, 'mintOcrLeaseCommitPort', { value: function(presentedSession: ServerSession) {
                if (this !== portOwner) return fail('session_unavailable');
                return completedOwner.mintOcrLeaseCommitPort(presentedSession);
            } });
            ObjectDefineProperty(portOwner, 'mintDocumentSynthesisLeaseCommitPort', { value: function(presentedSession: ServerSession) {
                if (this !== portOwner) return fail('session_unavailable');
                return completedOwner.mintDocumentSynthesisLeaseCommitPort(presentedSession);
            } });
            ObjectDefineProperty(portOwner, 'mintTreatmentReasoningLeaseCommitPort', { value: function(presentedSession: ServerSession) {
                if (this !== portOwner) return fail('session_unavailable');
                return completedOwner.mintTreatmentReasoningLeaseCommitPort(presentedSession);
            } });
            ObjectDefineProperty(portOwner, 'mintDurableReviewCommitPort', { value: function(presentedSession: ServerSession) {
                if (this !== portOwner) return fail('session_unavailable');
                return completedOwner.mintDurableReviewCommitPort(presentedSession);
            } });
            ObjectDefineProperty(portOwner, 'dispose', { value: function() {
                if (this !== portOwner) return fail('session_unavailable');
                return completedOwner.dispose();
            } });
            const completedPortOwner = ObjectFreeze(portOwner);

            if (authorityKind === 'legacy') {
                unregisterOwner = registerServerSessionResource(session.id, () => finish(false));
                if (!unregisterOwner) return fail('session_ineligible');
                publishedOwner = completedOwner;
                setMapValue(owners, session.id, publishedOwner);
                addOwnerIdentity(registryOwners, completedOwner);
                addOwnerIdentity(authenticOwners, completedOwner);
                return completedOwner as Owner;
            }
            authorityPort = mintResourcePort(session);
            if (!authorityPort) return fail('session_ineligible');
            const acquisitionUse = beginResourceUse(authorityPort);
            if (!acquisitionUse) { releaseResourcePort(authorityPort); return fail('session_ineligible'); }
            let revealed = false;
            const exposedOwner = authorityKind === 'port-full' ? completedOwner : completedPortOwner;
            try {
                unregisterOwner = () => { if (authorityPort) releaseResourcePort(authorityPort); };
                publishedOwner = exposedOwner;
                setMapValue(owners, session.id, publishedOwner);
                registryNode = { owner: exposedOwner, authority: authorityPort,
                    previous: null, next: portRegistryHead, active: true };
                if (portRegistryHead) portRegistryHead.previous = registryNode;
                portRegistryHead = registryNode;
                deleteSetValue(acquiring, session.id);
                acquisitionCleared = true;
                portRevealActive = true;
                if (!commitResourceUse(acquisitionUse)) return fail('session_ineligible');
                portRevealActive = false;
                revealed = true;
                if (authorityKind === 'port-full') addOwnerIdentity(authenticOwners, completedOwner);
                return exposedOwner as Owner;
            } finally {
                if (!revealed) {
                    portRevealActive = false;
                    abortResourceUse(acquisitionUse);
                    unlinkPortNode(registryNode); registryNode = null;
                    if (getMapValue(owners, session.id) === exposedOwner) deleteMapValue(owners, session.id);
                    releaseResourcePort(authorityPort);
                    authorityPort = null;
                    terminal = true;
                }
                if (!acquisitionCleared) deleteSetValue(acquiring, session.id);
            }
            } finally {
                if (!acquisitionCleared) deleteSetValue(acquiring, session.id);
            }
        },
    };
    return ObjectFreeze({ registry: ObjectFreeze(registry), selectionLifecycleController });
}

export function createLegacyProjectionOwnerFactory(sourceOverrides: Partial<SelectionSources> = {}) {
    return createProjectionOwnerProcessOwner<ServerSessionProjectionOwner>('legacy', sourceOverrides).registry;
}

export function createPortProjectionOwnerFactory(sourceOverrides: Partial<SelectionSources> = {}) {
    return createProjectionOwnerProcessOwner<PortServerSessionProjectionOwner>('port', sourceOverrides).registry;
}

/** Creates the full projection surface while external-owner ports govern Web currentness and cleanup. */
/* @Codex */
export function createFullPortProjectionOwnerFactory(sourceOverrides: Partial<SelectionSources> = {}) {
    return createFullPortProjectionOwnerProcessOwner(sourceOverrides).registry;
}

/** Shares one final-owner registry with its private selection lifecycle controller. */
/* @Codex */
export function createFullPortProjectionOwnerProcessOwner(sourceOverrides: Partial<SelectionSources> = {}) {
    return createProjectionOwnerProcessOwner<ServerSessionProjectionOwner>('port-full', sourceOverrides);
}

export function createServerSessionProjectionOwnerRegistry(sourceOverrides: Partial<SelectionSources> = {}) {
    return createLegacyProjectionOwnerFactory(sourceOverrides);
}
