/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';

import { buildPatientInsightExtractionPrompt, isEnvelopeUsable, parsePatientInsightExtractionResponse } from '../../ai-task-contracts';
import type { HostLocalProviderBindingResult } from '../host-local-provider-binding';
import type { HostLocalProviderReadinessResult } from '../host-local-provider-readiness';
import type { LocalProviderResolution } from '../registry';
import type { FabricExecutionPolicy, FabricProvenanceRecord, FabricResolutionReceipt } from './contract';
import { GENERATIVE_CAPABILITY_DESCRIPTORS } from './generative-catalog';
import type { PatientInsightProjection } from './patient-insight-host-boundary';
import type { routeHostResolvedCandidateCapability, HostResolvedCandidateRoutingInput } from './candidate-router';
import type { ProviderLifecycleRead } from './provider-lifecycle-service';
import { buildProvenanceRecord } from './resolver';
import type {
    PatientInsightDenialCode,
    PatientInsightFailureCode,
    PatientInsightProposalCurrentness,
    PatientInsightReviewProposal,
} from './patient-insight-preview-contract';

type Common = Readonly<{ writesPerformed: 0; apply: 'denied' }>;
export type PatientInsightHostCapabilityResult =
    | (Common & Readonly<{ status: 'available'; code: null; proposal: PatientInsightReviewProposal; receipt: FabricResolutionReceipt; provenance: FabricProvenanceRecord; reviewRef: string }>)
    | (Common & Readonly<{ status: 'denied'; code: PatientInsightDenialCode; proposal: null; receipt: null; provenance: null; reviewRef: null }>)
    | (Common & Readonly<{ status: 'failed'; code: PatientInsightFailureCode; proposal: null; receipt: FabricResolutionReceipt; provenance: FabricProvenanceRecord; reviewRef: null }>);

type Sources = Readonly<{ clock(): unknown; entropy(): unknown }>;
type Dependencies = Readonly<{
    killSwitch: Readonly<{ read(): Promise<Readonly<{ status: 'enabled' }> | Readonly<{ status: 'denied'; code: 'disabled' | 'unavailable' }>> }>;
    currentness: Readonly<{ verify(): boolean }>;
    lifecycle: Readonly<{ read(): ProviderLifecycleRead }>;
    binding: Readonly<{ readClinical(): Promise<HostLocalProviderBindingResult> }>;
    readiness: Readonly<{ observeClinical(resolution: LocalProviderResolution): Promise<HostLocalProviderReadinessResult> }>;
    route: typeof routeHostResolvedCandidateCapability;
    sources?: Sources;
}>;

type PreviewInput = Readonly<{ requestId: string; projection: PatientInsightProjection; currentness: PatientInsightProposalCurrentness }>;
const descriptor = GENERATIVE_CAPABILITY_DESCRIPTORS.patient_insight;
const common = Object.freeze({ writesPerformed: 0 as const, apply: 'denied' as const });
const productionSources: Sources = Object.freeze({ clock: () => new Date().toISOString(), entropy: () => randomBytes(16) });
const requestIdPattern = /^[A-Za-z][A-Za-z0-9._:-]{15,127}$/u;
const digestPattern = /^sha256_[0-9a-f]{64}$/u;

function deny(code: PatientInsightDenialCode): PatientInsightHostCapabilityResult {
    return Object.freeze({ ...common, status: 'denied', code, proposal: null, receipt: null, provenance: null, reviewRef: null });
}
function failed(code: PatientInsightFailureCode, receipt: FabricResolutionReceipt, provenance: FabricProvenanceRecord): PatientInsightHostCapabilityResult {
    return Object.freeze({ ...common, status: 'failed', code, proposal: null, receipt, provenance, reviewRef: null });
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor?.enumerable || !('value' in descriptor)) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}
function iso(value: unknown): string | null {
    return typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value))
        && new Date(value).toISOString() === value ? value : null;
}
function text(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= 240 && value.trim() === value ? value : null;
}
function strings(value: unknown): readonly string[] | null {
    try {
        if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 12
            || Reflect.ownKeys(value).length !== value.length + 1) return null;
        const output: string[] = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            const item = descriptor && 'value' in descriptor ? text(descriptor.value) : null;
            if (!item) return null;
            output.push(item);
        }
        return Object.freeze(output);
    } catch { return null; }
}
function projection(value: unknown): PatientInsightProjection | null {
    const input = exact(value, ['schemaVersion', 'clinicalFocus', 'activeConditions', 'currentTherapies', 'recentClinicalEvents']);
    const focus = input && text(input.clinicalFocus); const conditions = input && strings(input.activeConditions);
    const therapies = input && strings(input.currentTherapies); const events = input && strings(input.recentClinicalEvents);
    return !input || input.schemaVersion !== 'mediflow.patient-insight.projection.v1' || !focus || !conditions || !therapies || !events
        ? null : Object.freeze({ schemaVersion: 'mediflow.patient-insight.projection.v1', clinicalFocus: focus,
            activeConditions: conditions, currentTherapies: therapies, recentClinicalEvents: events });
}
function snapshotCurrentness(value: unknown): PatientInsightProposalCurrentness | null {
    const input = exact(value, ['selectionEpoch', 'patientRevision', 'projectionDigest', 'capturedAt', 'verifiedAt']);
    const capturedAt = input && iso(input.capturedAt); const verifiedAt = input && iso(input.verifiedAt);
    return !input || !Number.isSafeInteger(input.selectionEpoch) || (input.selectionEpoch as number) < 1
        || !Number.isSafeInteger(input.patientRevision) || (input.patientRevision as number) < 1
        || typeof input.projectionDigest !== 'string' || !digestPattern.test(input.projectionDigest) || !capturedAt || !verifiedAt
        ? null : Object.freeze({ selectionEpoch: input.selectionEpoch as number, patientRevision: input.patientRevision as number,
            projectionDigest: input.projectionDigest, capturedAt, verifiedAt });
}
function previewInput(value: unknown): PreviewInput | null {
    const input = exact(value, ['requestId', 'projection', 'currentness']);
    const minimized = input && projection(input.projection); const fresh = input && snapshotCurrentness(input.currentness);
    return !input || typeof input.requestId !== 'string' || !requestIdPattern.test(input.requestId) || !minimized || !fresh
        ? null : Object.freeze({ requestId: input.requestId, projection: minimized, currentness: fresh });
}
function policy(requestId: string): FabricExecutionPolicy {
    return Object.freeze({ schemaVersion: 'mediflow.ai.execution-policy.v1', requestId, capability: 'patient_insight',
        authorityPlane: 'clinical_application', operation: descriptor.operation, dataClass: descriptor.dataClass,
        allowedVenues: Object.freeze(['local_process'] as const), egressProfileId: descriptor.egressProfileId,
        consentRef: null, retention: 'not_persisted', review: descriptor.review, provenanceRequired: true, fallback: 'none' });
}
function sourcePrompt(value: PatientInsightProjection): string {
    let index = 1; const lines = [`[S${index++}] ${value.clinicalFocus}`];
    for (const item of value.activeConditions) lines.push(`[S${index++}] Condizione attiva: ${item}`);
    for (const item of value.currentTherapies) lines.push(`[S${index++}] Terapia corrente: ${item}`);
    for (const item of value.recentClinicalEvents) lines.push(`[S${index++}] Evento clinico recente: ${item}`);
    return buildPatientInsightExtractionPrompt(lines.join('\n'));
}
function supportedClaim(value: string, sourceCount: number): boolean {
    const groups = value.match(/\[(?:S\d+|DATI-INCOMPLETI)(?:,\s*(?:S\d+|DATI-INCOMPLETI))*\]/gu) ?? [];
    if (groups.length === 0) return false;
    return groups.flatMap((group) => group.slice(1, -1).split(',').map((token) => token.trim())).every((token) => {
        if (token === 'DATI-INCOMPLETI') return true;
        const index = Number(token.slice(1));
        return /^S\d+$/u.test(token) && Number.isSafeInteger(index) && index >= 1 && index <= sourceCount;
    });
}
function supportedExtraction(value: ReturnType<typeof parsePatientInsightExtractionResponse>['value'], sourceCount: number): boolean {
    const claims = [value.summary, ...value.data.currentState, ...value.data.alerts, ...value.data.nextSteps, ...value.data.gaps]
        .filter((claim) => claim.length > 0);
    return claims.length > 0 && claims.every((claim) => supportedClaim(claim, sourceCount));
}
function generatedMetadata(sources: Sources): Readonly<{ timestamp: string; reviewRef: string }> | null {
    try {
        const timestamp = iso(sources.clock()); const entropy = sources.entropy();
        if (!timestamp || !(entropy instanceof Uint8Array) || entropy.byteLength < 16) return null;
        return Object.freeze({ timestamp, reviewRef: `review_${Array.from(entropy.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')}` });
    } catch { return null; }
}

/** Executes Patient Insight through the fixed host-resolved Fabric route; it has no apply or persistence seam. */
export function createPatientInsightHostCapability(dependencies: Dependencies) {
    const sources = dependencies.sources ?? productionSources;
    return Object.freeze({
        async preview(value: unknown): Promise<PatientInsightHostCapabilityResult> {
            const request = previewInput(value); if (!request) return deny('input_invalid');
            try {
                const state = await dependencies.killSwitch.read();
                if (state.status !== 'enabled') return deny(state.code === 'disabled' ? 'kill_switch_disabled' : 'kill_switch_unavailable');
            } catch { return deny('kill_switch_unavailable'); }
            try { if (dependencies.currentness.verify() !== true) return deny('source_stale'); }
            catch { return deny('source_stale'); }
            let lifecycleState: Extract<ProviderLifecycleRead, { status: 'available' }>;
            try {
                const lifecycle = dependencies.lifecycle.read();
                if (lifecycle.status !== 'available') return deny(lifecycle.reason === 'missing' ? 'lifecycle_missing'
                    : lifecycle.reason === 'corrupt' ? 'lifecycle_corrupt' : 'lifecycle_unavailable');
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
                if (readiness.status !== 'available') return deny(readiness.code === 'model_unavailable' ? 'model_unavailable' : 'provider_unready');
                observation = readiness.observation;
            } catch { return deny('provider_unready'); }
            let routed: ReturnType<typeof routeHostResolvedCandidateCapability>;
            try {
                const routeInput: HostResolvedCandidateRoutingInput = Object.freeze({
                    policy: policy(request.requestId), request: Object.freeze({ descriptor, venue: 'local_process', generative: binding }),
                    observations: Object.freeze([observation]),
                });
                routed = dependencies.route(routeInput, lifecycleState.record.lifecycle);
            } catch { return deny('fabric_denied'); }
            const resolution = routed.resolution; const routedBinding = resolution?.generative;
            if (routed.decision.outcome !== 'resolved' || !routed.decision.receipt || !resolution
                || routed.decision.receipt !== resolution.receipt || routedBinding !== binding) return deny('fabric_denied');
            const receipt = resolution.receipt;
            const metadata = generatedMetadata(sources); if (!metadata) return deny('source_invalid');
            let provenance: FabricProvenanceRecord; let prompt: string;
            try { provenance = buildProvenanceRecord(resolution, ['context_minimization', 'envelope_validation']); prompt = sourcePrompt(request.projection); }
            catch { return deny('fabric_denied'); }
            let response: string;
            try {
                const result = await routedBinding.adapter.chat([{ role: 'user', content: prompt }], undefined, 900, { responseFormat: 'json' });
                if (typeof result.content !== 'string') throw new Error('invalid'); response = result.content;
            } catch { return failed('provider_failed', receipt, provenance); }
            let proposal: PatientInsightReviewProposal;
            try {
                const parsed = parsePatientInsightExtractionResponse(response);
                if (!isEnvelopeUsable(parsed) || !(parsed.value.summary || parsed.value.data.currentState.length
                    || parsed.value.data.alerts.length || parsed.value.data.nextSteps.length || parsed.value.data.gaps.length)
                    || !supportedExtraction(parsed.value, 1 + request.projection.activeConditions.length
                        + request.projection.currentTherapies.length + request.projection.recentClinicalEvents.length)) throw new Error('invalid');
                proposal = Object.freeze({ schemaVersion: 'mediflow.patient-insight.review-proposal.v2', reviewOnly: true,
                    summary: parsed.value.summary, currentState: Object.freeze([...parsed.value.data.currentState]),
                    alerts: Object.freeze([...parsed.value.data.alerts]), nextSteps: Object.freeze([...parsed.value.data.nextSteps]),
                    gaps: Object.freeze([...parsed.value.data.gaps]), generatedAt: metadata.timestamp,
                    currentness: Object.freeze({ ...request.currentness, verifiedAt: metadata.timestamp }) });
            } catch { return failed('proposal_invalid', receipt, provenance); }
            try { if (dependencies.currentness.verify() !== true) return failed('source_stale', receipt, provenance); }
            catch { return failed('source_stale', receipt, provenance); }
            return Object.freeze({ ...common, status: 'available', code: null, proposal, receipt, provenance, reviewRef: metadata.reviewRef });
        },
    });
}
