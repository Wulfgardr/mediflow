/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { createDocumentSynthesisSourceSetLease, type DocumentSynthesisSourceSetExecution, type DocumentSynthesisSourceSetLease } from './document-synthesis-source-set-lease';
import { claimDocumentSynthesisProviderBindingForExecution, type DocumentSynthesisProviderBindingReceipt } from './document-synthesis-provider-binding';
import { digestDocumentSynthesisClaimCitations } from './document-synthesis-claim-citations-digest';
import { FABRIC_CAPABILITY_DESCRIPTORS } from './catalog';
import { buildProvenanceRecord, resolveFabricCapabilityWithHostResolution, type FabricResolution } from './resolver';
import type { FabricProvenanceRecord, FabricResolutionReceipt } from './contract';
import type { DocumentSynthesisSourceSetValidationResult } from './document-synthesis-source-set-currentness-owner';
import type { LocalProviderResolution } from '../registry';

export type DocumentSynthesisFabricAdmissionToken = object;
export type DocumentSynthesisFabricExecutionHandoff = object;
export type DocumentSynthesisFabricAdmissionResult = Readonly<{ status: 'available' | 'denied'; code: null | 'input_invalid' | 'binding_invalid' | 'source_unavailable' | 'resolution_invalid'; token: DocumentSynthesisFabricAdmissionToken | null; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none'; fallback: 'denied_by_contract' }>;
export type DocumentSynthesisFabricCommittedMetadata = Readonly<{ receipt: FabricResolutionReceipt; provenance: FabricProvenanceRecord }>;
export type DocumentSynthesisFabricExecutionCapability = Readonly<{ takeProviderInput(): Readonly<{ prompt: string }> | null; validateProviderEnvelope(envelopeToken: unknown): DocumentSynthesisSourceSetValidationResult; finalize(): PrivatePublication | null; abort(): void }>;
export type DocumentSynthesisFabricExecutionAdmission = Readonly<{
    resolution: LocalProviderResolution; execution: DocumentSynthesisFabricExecutionCapability;
}>;
type AvailableValidation = Extract<DocumentSynthesisSourceSetValidationResult, Readonly<{ status: 'available' }>>;
type PrivatePublication = Readonly<{ schemaVersion: 'mediflow.document-synthesis.publication.v1'; output: AvailableValidation['output']; citations: AvailableValidation['citations']; claims: AvailableValidation['claims']; receipt: Readonly<{ schemaVersion: 'mediflow.document-synthesis.publication-receipt.v1'; capability: 'document_synthesis'; outputSha256: string; claimCitationsDigestSha256: readonly number[]; sourceSetDigestSha256: readonly number[]; providerBindingReceipt: DocumentSynthesisProviderBindingReceipt; reviewOnly: true; applyPolicy: 'none'; writesPerformed: 0 }>; provenance: Readonly<{ schemaVersion: 'mediflow.document-synthesis.publication-provenance.v1'; capability: 'document_synthesis'; sourceSetAuthority: 'application_host'; inputDigestScope: 'ordered_normalized_provider_projection_set'; citationSupport: 'provider_declared_host_membership_and_locator_validated'; modelCausality: 'not_established'; fabricProvenance: FabricProvenanceRecord }> }>;
type Entry = { state: 'pending' | 'in_flight' | 'handoff_taken' | 'finalized' | 'aborted'; admissionToken: object; providerToken: object; lease: DocumentSynthesisSourceSetLease; leaseToken: object; executionToken: DocumentSynthesisSourceSetExecution | null; handoff: object | null; prepared: DocumentSynthesisFabricCommittedMetadata | null; bindingReceipt: DocumentSynthesisProviderBindingReceipt | null; validation: AvailableValidation | null; publication: PrivatePublication | null; capability: DocumentSynthesisFabricExecutionCapability; execution: DocumentSynthesisFabricExecutionAdmission | null };
const OBJECT = Object.prototype; const ObjectAssign = Object.assign; const ObjectCreate = Object.create; const ObjectFreeze = Object.freeze; const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor; const ObjectGetPrototypeOf = Object.getPrototypeOf; const ObjectIsFrozen = Object.isFrozen; const ObjectHasOwn = Object.hasOwn; const ReflectOwnKeys = Reflect.ownKeys; const IsProxy = types.isProxy;
const WeakMapConstructor = WeakMap; const weakMapGet = WeakMap.prototype.get; const weakMapSet = WeakMap.prototype.set; const weakMapDelete = WeakMap.prototype.delete; const apply = Reflect.apply;
const admissions = new WeakMapConstructor<object, Entry>(); const handoffs = new WeakMapConstructor<object, Entry>(); const COMMON = ObjectFreeze({ reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const, fallback: 'denied_by_contract' as const });
const validationDenied = ObjectFreeze({ status: 'denied' as const, code: 'input_invalid' as const, output: null, outputSha256: null, citations: null, claims: null, reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const, sourceSetDigestSha256: null }) as DocumentSynthesisSourceSetValidationResult;

function frozen<T extends Record<string, unknown>>(value: T): Readonly<T> { return ObjectFreeze(ObjectAssign(ObjectCreate(null) as T, value)); }
function record(value: unknown): Record<string, unknown> | null {
    try { if (typeof value !== 'object' || value === null || IsProxy(value) || !ObjectIsFrozen(value) || ObjectGetPrototypeOf(value) !== OBJECT || ReflectOwnKeys(value).length !== 4) return null; const output = ObjectCreate(null) as Record<string, unknown>; for (const key of ['owner', 'session', 'capsule', 'providerToken']) { const descriptor = ObjectGetOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value')) return null; output[key] = descriptor.value; } return output; } catch { return null; }
}
function denied(code: Exclude<DocumentSynthesisFabricAdmissionResult['code'], null>): DocumentSynthesisFabricAdmissionResult { return frozen({ status: 'denied' as const, code, token: null, ...COMMON }); }
function resolution(provider: LocalProviderResolution): FabricResolution | null {
    const descriptor = FABRIC_CAPABILITY_DESCRIPTORS.document_synthesis;
    try { const resolved = resolveFabricCapabilityWithHostResolution(ObjectFreeze({ schemaVersion: 'mediflow.ai.execution-policy.v1' as const, requestId: 'document-synthesis-host-admission', capability: 'document_synthesis' as const, authorityPlane: 'clinical_application' as const, operation: descriptor.operation, dataClass: descriptor.dataClass, allowedVenues: ObjectFreeze(['local_process'] as const), egressProfileId: 'local_only' as const, consentRef: null, retention: 'not_persisted' as const, review: 'review_first' as const, provenanceRequired: true as const, fallback: 'none' as const }), ObjectFreeze({ descriptor, venue: 'local_process' as const, generative: provider })); return resolved.receipt.capability === 'document_synthesis' && resolved.receipt.venue === 'local_process' && resolved.receipt.egressProfile.egress === 'none' && resolved.receipt.fallbackCount === 0 ? resolved : null; } catch { return null; }
}
function precomputePublication(validation: AvailableValidation, bindingReceipt: DocumentSynthesisProviderBindingReceipt | null, prepared: DocumentSynthesisFabricCommittedMetadata | null): PrivatePublication | null {
    try {
        const claimCitationsDigestSha256 = digestDocumentSynthesisClaimCitations(validation);
        if (!claimCitationsDigestSha256 || !bindingReceipt || !prepared || prepared.provenance.receipt !== prepared.receipt) return null;
        const receipt = frozen({ schemaVersion: 'mediflow.document-synthesis.publication-receipt.v1' as const, capability: 'document_synthesis' as const, outputSha256: validation.outputSha256, claimCitationsDigestSha256, sourceSetDigestSha256: validation.sourceSetDigestSha256, providerBindingReceipt: bindingReceipt, reviewOnly: true as const, applyPolicy: 'none' as const, writesPerformed: 0 as const });
        const provenance = frozen({ schemaVersion: 'mediflow.document-synthesis.publication-provenance.v1' as const, capability: 'document_synthesis' as const, sourceSetAuthority: 'application_host' as const, inputDigestScope: 'ordered_normalized_provider_projection_set' as const, citationSupport: 'provider_declared_host_membership_and_locator_validated' as const, modelCausality: 'not_established' as const, fabricProvenance: prepared.provenance });
        return frozen({ schemaVersion: 'mediflow.document-synthesis.publication.v1' as const, output: validation.output, citations: validation.citations, claims: validation.claims, receipt, provenance }) as PrivatePublication;
    } catch { return null; }
}
function forget(token: object, entry: Entry) { entry.state = 'aborted'; entry.lease.dispose(); apply(weakMapDelete, admissions, [token]); if (entry.handoff) apply(weakMapDelete, handoffs, [entry.handoff]); }

/** Admits one source set; it only exposes an opaque, server-only handoff and never invokes a provider. */
export function admitDocumentSynthesisFabric(value: unknown): DocumentSynthesisFabricAdmissionResult {
    const input = record(value); const providerToken = input?.providerToken; if (!input || typeof providerToken !== 'object' || providerToken === null || IsProxy(providerToken)) return denied('input_invalid');
    let lease: DocumentSynthesisSourceSetLease; try { lease = createDocumentSynthesisSourceSetLease(ObjectFreeze({ owner: input.owner, session: input.session, capsule: input.capsule })); } catch { return denied('input_invalid'); }
    const leaseToken = lease.issue(); if (!leaseToken || typeof leaseToken !== 'object') { lease.dispose(); return denied('source_unavailable'); }
    const token = ObjectFreeze(ObjectCreate(null)) as DocumentSynthesisFabricAdmissionToken; const entry = {} as Entry;
    const denyFinalized = () => { const executionToken = entry.executionToken; if (executionToken) entry.lease.takeProviderInput(executionToken); };
    const abort = () => { if (entry.state === 'finalized') { denyFinalized(); return; } if (entry.state === 'aborted') return; forget(token, entry); };
    const finalize = (): PrivatePublication | null => {
        if (entry.state === 'finalized') { denyFinalized(); return null; }
        if (entry.state !== 'handoff_taken' || !entry.executionToken || !entry.prepared || !entry.validation || !entry.publication) { abort(); return null; }
        const publication = entry.publication; const lease = entry.lease; const executionToken = entry.executionToken; const admissionToken = token; const handoff = entry.handoff; const deny = () => { lease.dispose(); apply(weakMapDelete, admissions, [admissionToken]); if (handoff) apply(weakMapDelete, handoffs, [handoff]); };
        entry.state = 'finalized'; try { if (!lease.consume(executionToken)) { deny(); return null; } return publication; } catch { deny(); return null; }
    };
    const validateProviderEnvelope = (envelopeToken: unknown) => { if (entry.state === 'finalized') { denyFinalized(); return validationDenied; } if (entry.state !== 'handoff_taken' || !entry.executionToken) { abort(); return validationDenied; } const result = entry.lease.validateProviderEnvelope(ObjectFreeze({ executionToken: entry.executionToken, envelopeToken })); if (result.status !== 'available') { abort(); return result; } const publication = precomputePublication(result, entry.bindingReceipt, entry.prepared); if (!publication) { abort(); return validationDenied; } entry.validation = result; entry.publication = publication; return result; };
    const capability = frozen({ takeProviderInput: () => { if (entry.state === 'finalized') { denyFinalized(); return null; } return entry.state === 'handoff_taken' && entry.executionToken ? entry.lease.takeProviderInput(entry.executionToken) : null; }, validateProviderEnvelope, finalize, abort }) as DocumentSynthesisFabricExecutionCapability;
    entry.state = 'pending'; entry.admissionToken = token; entry.providerToken = providerToken; entry.lease = lease; entry.leaseToken = leaseToken; entry.executionToken = null; entry.handoff = null; entry.prepared = null; entry.bindingReceipt = null; entry.validation = null; entry.publication = null; entry.capability = capability; entry.execution = null;
    apply(weakMapSet, admissions, [token, entry]); return frozen({ status: 'available' as const, code: null, token, ...COMMON });
}

/** Atomically starts exactly one handoff; the returned token reveals no source or provider input. */
export function beginDocumentSynthesisFabricExecution(token: unknown): DocumentSynthesisFabricExecutionHandoff | null {
    try { if (typeof token !== 'object' || token === null || IsProxy(token)) return null; const entry = apply(weakMapGet, admissions, [token]) as Entry | undefined; if (!entry || entry.state !== 'pending') return null; entry.state = 'in_flight'; const executionToken = entry.lease.beginExecution(entry.leaseToken); if (!executionToken) { forget(token, entry); return null; } const handoff = ObjectFreeze(ObjectCreate(null)); entry.executionToken = executionToken; entry.handoff = handoff; apply(weakMapSet, handoffs, [handoff, entry]); return handoff as DocumentSynthesisFabricExecutionHandoff; } catch { return null; }
}

/** Resolves a handoff once into provider metadata plus a tightly scoped server-only capability. */
export function resolveDocumentSynthesisFabricExecutionHandoff(handoff: unknown): DocumentSynthesisFabricExecutionAdmission | null {
    try {
        if (typeof handoff !== 'object' || handoff === null || IsProxy(handoff)) return null;
        const entry = apply(weakMapGet, handoffs, [handoff]) as Entry | undefined; if (!entry || entry.state !== 'in_flight') return null;
        const binding = claimDocumentSynthesisProviderBindingForExecution(entry.providerToken); if (!binding || binding.status !== 'claimed') { forget(entry.admissionToken, entry); return null; }
        const resolved = resolution(binding.resolution); if (!resolved) { forget(entry.admissionToken, entry); return null; }
        let provenance: FabricProvenanceRecord; try { provenance = buildProvenanceRecord(resolved, ['context_minimization']); } catch { forget(entry.admissionToken, entry); return null; }
        entry.prepared = frozen({ receipt: resolved.receipt, provenance }) as DocumentSynthesisFabricCommittedMetadata;
        entry.bindingReceipt = binding.receipt;
        entry.execution = frozen({ resolution: binding.resolution, execution: entry.capability }) as DocumentSynthesisFabricExecutionAdmission;
        entry.state = 'handoff_taken'; apply(weakMapDelete, handoffs, [handoff]); return entry.execution;
    } catch { return null; }
}

/** Cancels pending or in-flight work and burns every retained opaque handoff. */
export function disposeDocumentSynthesisFabricAdmission(token: unknown): void { try { if (typeof token !== 'object' || token === null || IsProxy(token)) return; const entry = apply(weakMapGet, admissions, [token]) as Entry | undefined; if (entry) { if (entry.state === 'finalized') { entry.lease.dispose(); return; } forget(token, entry); } } catch { /* Opaque cancellation stays fail-closed. */ } }
