/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { createDocumentSynthesisSourceSetLease, type DocumentSynthesisSourceSetLease } from './document-synthesis-source-set-lease';
import { resolveDocumentSynthesisProviderBinding, type DocumentSynthesisProviderBindingToken } from './document-synthesis-provider-binding';
import { FABRIC_CAPABILITY_DESCRIPTORS } from './catalog';
import { buildProvenanceRecord, resolveFabricCapabilityWithHostResolution, type FabricResolution } from './resolver';
import type { FabricProvenanceRecord, FabricResolutionReceipt } from './contract';

export type DocumentSynthesisFabricAdmissionToken = object;
export type DocumentSynthesisFabricAdmissionResult = Readonly<{
    status: 'available' | 'denied'; code: null | 'input_invalid' | 'binding_invalid' | 'source_unavailable' | 'resolution_invalid';
    token: DocumentSynthesisFabricAdmissionToken | null; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none'; fallback: 'denied_by_contract';
}>;
export type DocumentSynthesisFabricExecutionAdmission = Readonly<{
    providerToken: DocumentSynthesisProviderBindingToken; receipt: FabricResolutionReceipt; provenance: FabricProvenanceRecord; finalizeAfterProviderWork(): boolean;
}>;

type Entry = { state: 'active' | 'finalized' | 'disposed'; lease: DocumentSynthesisSourceSetLease; leaseToken: object; execution: DocumentSynthesisFabricExecutionAdmission };
const OBJECT = Object.prototype;
const ObjectAssign = Object.assign;
const ObjectCreate = Object.create;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectIsFrozen = Object.isFrozen;
const ObjectHasOwn = Object.hasOwn;
const ReflectOwnKeys = Reflect.ownKeys;
const IsProxy = types.isProxy;
const WeakMapConstructor = WeakMap;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const weakMapDelete = WeakMap.prototype.delete;
const apply = Reflect.apply;
const admissions = new WeakMapConstructor<object, Entry>();
const COMMON = ObjectFreeze({ reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const, fallback: 'denied_by_contract' as const });

function frozen<T extends Record<string, unknown>>(value: T): Readonly<T> { return ObjectFreeze(ObjectAssign(ObjectCreate(null) as T, value)); }
function record(value: unknown): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || IsProxy(value) || !ObjectIsFrozen(value) || ObjectGetPrototypeOf(value) !== OBJECT) return null;
        const keys = ReflectOwnKeys(value); if (keys.length !== 4) return null;
        let ownerKey = false; let sessionKey = false; let capsuleKey = false; let providerTokenKey = false;
        for (let index = 0; index < 4; index += 1) { const key = keys[index]; if (key === 'owner') ownerKey = true; else if (key === 'session') sessionKey = true; else if (key === 'capsule') capsuleKey = true; else if (key === 'providerToken') providerTokenKey = true; else return null; }
        if (!ownerKey || !sessionKey || !capsuleKey || !providerTokenKey) return null;
        const owner = ObjectGetOwnPropertyDescriptor(value, 'owner'); const session = ObjectGetOwnPropertyDescriptor(value, 'session'); const capsule = ObjectGetOwnPropertyDescriptor(value, 'capsule'); const providerToken = ObjectGetOwnPropertyDescriptor(value, 'providerToken');
        if (!owner || !session || !capsule || !providerToken || !owner.enumerable || !session.enumerable || !capsule.enumerable || !providerToken.enumerable || !ObjectHasOwn(owner, 'value') || !ObjectHasOwn(session, 'value') || !ObjectHasOwn(capsule, 'value') || !ObjectHasOwn(providerToken, 'value')) return null;
        return ObjectAssign(ObjectCreate(null) as Record<string, unknown>, { owner: owner.value, session: session.value, capsule: capsule.value, providerToken: providerToken.value });
    } catch { return null; }
}
function denied(code: Exclude<DocumentSynthesisFabricAdmissionResult['code'], null>): DocumentSynthesisFabricAdmissionResult { return frozen({ status: 'denied' as const, code, token: null, ...COMMON }); }
function resolution(providerToken: DocumentSynthesisProviderBindingToken): FabricResolution | null {
    const provider = resolveDocumentSynthesisProviderBinding(providerToken);
    if (!provider) return null;
    const descriptor = FABRIC_CAPABILITY_DESCRIPTORS.document_synthesis;
    try {
        const resolved = resolveFabricCapabilityWithHostResolution(ObjectFreeze({ schemaVersion: 'mediflow.ai.execution-policy.v1' as const, requestId: 'document-synthesis-host-admission', capability: 'document_synthesis' as const, authorityPlane: 'clinical_application' as const, operation: descriptor.operation, dataClass: descriptor.dataClass, allowedVenues: ObjectFreeze(['local_process'] as const), egressProfileId: 'local_only' as const, consentRef: null, retention: 'not_persisted' as const, review: 'review_first' as const, provenanceRequired: true as const, fallback: 'none' as const }), ObjectFreeze({ descriptor, venue: 'local_process' as const, generative: provider }));
        return resolved.receipt.capability === 'document_synthesis' && resolved.receipt.venue === 'local_process' && resolved.receipt.egressProfile.egress === 'none' && resolved.receipt.fallbackCount === 0 ? resolved : null;
    } catch { return null; }
}

/** Admits one authenticated source-set and sealed provider binding without provider execution or source consumption. */
export function admitDocumentSynthesisFabric(value: unknown): DocumentSynthesisFabricAdmissionResult {
    const input = record(value); const providerToken = input?.providerToken;
    if (!input || typeof providerToken !== 'object' || providerToken === null || IsProxy(providerToken)) return denied('input_invalid');
    const resolved = resolution(providerToken); if (!resolved) return denied('binding_invalid');
    let lease: DocumentSynthesisSourceSetLease;
    try { lease = createDocumentSynthesisSourceSetLease(ObjectFreeze({ owner: input.owner, session: input.session, capsule: input.capsule })); } catch { return denied('input_invalid'); }
    const leaseToken = lease.issue();
    if (!leaseToken || typeof leaseToken !== 'object') { lease.dispose(); return denied('source_unavailable'); }
    let provenance: FabricProvenanceRecord;
    try { provenance = buildProvenanceRecord(resolved, ['context_minimization']); } catch { lease.dispose(); return denied('resolution_invalid'); }
    const token = ObjectFreeze(ObjectCreate(null)) as DocumentSynthesisFabricAdmissionToken;
    const entry = {} as Entry;
    const finalizeAfterProviderWork = () => {
        if (entry.state !== 'active') return false;
        entry.state = 'finalized'; const finalized = entry.lease.consume(entry.leaseToken); apply(weakMapDelete, admissions, [token]); return finalized;
    };
    entry.state = 'active'; entry.lease = lease; entry.leaseToken = leaseToken;
    entry.execution = frozen({ providerToken: providerToken as DocumentSynthesisProviderBindingToken, receipt: resolved.receipt, provenance, finalizeAfterProviderWork }) as DocumentSynthesisFabricExecutionAdmission;
    apply(weakMapSet, admissions, [token, entry]);
    return frozen({ status: 'available' as const, code: null, token, ...COMMON });
}

/** C3d3c-only handoff: authenticates the opaque admission before exposing its sealed provider token and finalizer. */
export function resolveDocumentSynthesisFabricAdmissionForExecution(token: unknown): DocumentSynthesisFabricExecutionAdmission | null {
    try { if (typeof token !== 'object' || token === null || IsProxy(token)) return null; const entry = apply(weakMapGet, admissions, [token]) as Entry | undefined; return entry?.state === 'active' ? entry.execution : null; } catch { return null; }
}

/** Cancels a pending admission without consuming its source-set lease. */
export function disposeDocumentSynthesisFabricAdmission(token: unknown): void {
    try { if (typeof token !== 'object' || token === null || IsProxy(token)) return; const entry = apply(weakMapGet, admissions, [token]) as Entry | undefined; if (!entry || entry.state !== 'active') return; entry.state = 'disposed'; entry.lease.dispose(); apply(weakMapDelete, admissions, [token]); } catch { /* Opaque cancellation stays fail-closed. */ }
}
