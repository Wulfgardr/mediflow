/* @Codex */
import 'server-only';
import { randomBytes } from 'node:crypto';
import type { SmartImportProjection } from '../../smart-import-projection';
import type { LocalProviderResolution } from '../../ai-providers/registry';
import type { HostLocalProviderBindingResult } from '../../ai-providers/host-local-provider-binding';
import type { HostLocalProviderReadinessResult } from '../../ai-providers/host-local-provider-readiness';
import type { ProviderLifecycleRead } from '../../ai-providers/fabric/provider-lifecycle-service';
import { GENERATIVE_CAPABILITY_DESCRIPTORS } from '../../ai-providers/fabric/generative-catalog';
import type {
    routeHostResolvedCandidateCapability,
    HostResolvedCandidateRoutingInput,
} from '../../ai-providers/fabric/candidate-router';
import { buildProvenanceRecord } from '../../ai-providers/fabric/resolver';
import type { FabricExecutionPolicy, FabricProvenanceRecord, FabricResolutionReceipt } from '../../ai-providers/fabric/contract';
import type { PatientSmartImportHostKillSwitchResult } from './patient-smart-import-host-kill-switch';
import {
    buildPatientSmartImportCapabilityPrompt,
    parsePatientSmartImportCapabilityProposal,
    type PatientSmartImportCapabilityProposal,
} from './patient-smart-import-capability-contract';
export type PatientSmartImportHostDenialCode =
    | 'input_invalid' | 'kill_switch_disabled' | 'kill_switch_unavailable'
    | 'projection_unavailable' | 'lifecycle_missing' | 'lifecycle_corrupt' | 'lifecycle_unavailable'
    | 'provider_binding_denied' | 'provider_unready' | 'model_unavailable' | 'fabric_denied' | 'source_invalid';
export type PatientSmartImportHostFailureCode = 'provider_failed' | 'proposal_invalid';
type Common = Readonly<{ writesPerformed: 0; apply: 'denied' }>;
export type PatientSmartImportHostCapabilityResult =
    | (Common & Readonly<{ status: 'available'; code: null; proposal: PatientSmartImportCapabilityProposal;
        receipt: FabricResolutionReceipt; provenance: FabricProvenanceRecord; reviewRef: string }>)
    | (Common & Readonly<{ status: 'denied'; code: PatientSmartImportHostDenialCode; proposal: null;
        receipt: null; provenance: null; reviewRef: null }>)
    | (Common & Readonly<{ status: 'failed'; code: PatientSmartImportHostFailureCode; proposal: null;
        receipt: FabricResolutionReceipt; provenance: FabricProvenanceRecord; reviewRef: null }>);
type Sources = Readonly<{ clock: () => unknown; entropy: () => unknown }>;
type Dependencies = Readonly<{
    killSwitch: Readonly<{ read(): Promise<PatientSmartImportHostKillSwitchResult> }>;
    broker: Readonly<{ consume(input: Readonly<{ handle: string; capability: 'smart_import'; requestId: string }>): SmartImportProjection }>;
    lifecycle: Readonly<{ read(): ProviderLifecycleRead }>;
    binding: Readonly<{ readClinical(): Promise<HostLocalProviderBindingResult> }>;
    readiness: Readonly<{ observeClinical(resolution: LocalProviderResolution): Promise<HostLocalProviderReadinessResult> }>;
    route: typeof routeHostResolvedCandidateCapability;
    sources?: Sources;
}>;
const descriptor = GENERATIVE_CAPABILITY_DESCRIPTORS.smart_import;
const productionSources: Sources = Object.freeze({
    clock: () => new Date().toISOString(),
    entropy: () => randomBytes(16),
});
const common = Object.freeze({ writesPerformed: 0 as const, apply: 'denied' as const });
function deny(code: PatientSmartImportHostDenialCode): PatientSmartImportHostCapabilityResult {
    return Object.freeze({ ...common, status: 'denied', code, proposal: null, receipt: null, provenance: null, reviewRef: null });
}
function failed(code: PatientSmartImportHostFailureCode, receipt: FabricResolutionReceipt,
    provenance: FabricProvenanceRecord): PatientSmartImportHostCapabilityResult {
    return Object.freeze({ ...common, status: 'failed', code, proposal: null, receipt, provenance, reviewRef: null });
}
function input(value: unknown): Readonly<{ handle: string; requestId: string }> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 2 || !keys.includes('handle') || !keys.includes('requestId')) return null;
    const handle = Object.getOwnPropertyDescriptor(value, 'handle');
    const requestId = Object.getOwnPropertyDescriptor(value, 'requestId');
    if (!handle || !('value' in handle) || typeof handle.value !== 'string' || !/^prj_[0-9a-f]{32}$/u.test(handle.value)
        || !requestId || !('value' in requestId) || typeof requestId.value !== 'string'
        || !/^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u.test(requestId.value)) return null;
    return Object.freeze({ handle: handle.value, requestId: requestId.value });
}
function policy(requestId: string): FabricExecutionPolicy {
    return Object.freeze({ schemaVersion: 'mediflow.ai.execution-policy.v1', requestId, capability: 'smart_import',
        authorityPlane: 'clinical_application', operation: descriptor.operation, dataClass: descriptor.dataClass,
        allowedVenues: Object.freeze(['local_process'] as const), egressProfileId: descriptor.egressProfileId,
        consentRef: null, retention: 'not_persisted', review: descriptor.review,
        provenanceRequired: true, fallback: 'none' });
}
function reviewRef(sources: Sources): string {
    const bytes = sources.entropy();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16) throw new Error('invalid');
    return `review_${Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
function timestamp(sources: Sources): string {
    const value = sources.clock();
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('invalid');
    return value;
}
export function createPatientSmartImportHostCapability(dependencies: Dependencies) {
    const sources = dependencies.sources ?? productionSources;
    return Object.freeze({
        async preview(value: unknown): Promise<PatientSmartImportHostCapabilityResult> {
            const request = input(value);
            if (!request) return deny('input_invalid');
            try {
                const killSwitch = await dependencies.killSwitch.read();
                if (killSwitch.status !== 'enabled') return deny(
                    killSwitch.status === 'denied' && killSwitch.code === 'disabled'
                        ? 'kill_switch_disabled' : 'kill_switch_unavailable');
            } catch { return deny('kill_switch_unavailable'); }
            let projection: SmartImportProjection;
            try { projection = dependencies.broker.consume({ ...request, capability: 'smart_import' }); }
            catch { return deny('projection_unavailable'); }
            let lifecycleState: Extract<ProviderLifecycleRead, { status: 'available' }>;
            try {
                const lifecycle = dependencies.lifecycle.read();
                if (lifecycle.status !== 'available') return deny(lifecycle.status === 'denied' && lifecycle.reason === 'missing'
                    ? 'lifecycle_missing' : lifecycle.status === 'denied' && lifecycle.reason === 'corrupt'
                        ? 'lifecycle_corrupt' : 'lifecycle_unavailable');
                lifecycleState = lifecycle;
            } catch { return deny('lifecycle_unavailable'); }
            let binding: LocalProviderResolution;
            try {
                const result = await dependencies.binding.readClinical();
                if (result.status !== 'available') return deny('provider_binding_denied');
                binding = result.resolution;
            } catch { return deny('provider_binding_denied'); }
            let observation: HostLocalProviderReadinessResult['observation'];
            try {
                const readiness = await dependencies.readiness.observeClinical(binding);
                if (readiness.status !== 'available') return deny(
                    readiness.status === 'denied' && readiness.code === 'model_unavailable'
                        ? 'model_unavailable' : 'provider_unready');
                observation = readiness.observation;
            } catch { return deny('provider_unready'); }
            let routed: ReturnType<typeof routeHostResolvedCandidateCapability>;
            try {
                const routeInput: HostResolvedCandidateRoutingInput = Object.freeze({
                    policy: policy(request.requestId),
                    request: Object.freeze({ descriptor, venue: 'local_process', generative: binding }),
                    observations: Object.freeze([observation]),
                });
                routed = dependencies.route(routeInput, lifecycleState.record.lifecycle);
            } catch { return deny('fabric_denied'); }
            const routedResolution = routed.resolution;
            const routedBinding = routedResolution?.generative;
            if (routed.decision.outcome !== 'resolved' || !routed.decision.receipt || !routedResolution
                || routed.decision.receipt !== routedResolution.receipt || routedBinding !== binding) return deny('fabric_denied');
            const receipt = routedResolution.receipt;
            let generatedAt: string;
            let correlation: string;
            try { generatedAt = timestamp(sources); correlation = reviewRef(sources); }
            catch { return deny('source_invalid'); }
            let provenance: FabricProvenanceRecord;
            let prompt: string;
            try {
                provenance = buildProvenanceRecord(routedResolution, ['context_minimization', 'envelope_validation']);
                prompt = buildPatientSmartImportCapabilityPrompt(projection);
            } catch { return deny('fabric_denied'); }

            let response: string;
            try {
                const providerResult = await routedBinding.adapter.chat(
                    [{ role: 'user', content: prompt }], undefined, 1_100, { responseFormat: 'json' },
                );
                response = providerResult.content;
                if (typeof response !== 'string') throw new Error('invalid');
            } catch { return failed('provider_failed', receipt, provenance); }
            let proposal: PatientSmartImportCapabilityProposal;
            try { proposal = parsePatientSmartImportCapabilityProposal(response, projection, generatedAt); }
            catch { return failed('proposal_invalid', receipt, provenance); }

            return Object.freeze({ ...common, status: 'available', code: null, proposal, receipt, provenance,
                reviewRef: correlation });
        },
    });
}
