/* @Codex */
import type { PairingReconnectionClass } from '../../network-pairing-lifecycle';
import { FABRIC_CAPABILITY_DESCRIPTORS } from './catalog';
import type { ProviderOnboardingState } from './onboarding';
import {
    admitProvider,
    ProviderLifecycleError,
    snapshotProviderLifecycle,
    type ProviderLifecycleState,
} from './provider-lifecycle';
import {
    FABRIC_VENUES,
    FabricPolicyError,
    type FabricCapabilityDescriptor,
    type FabricCapabilityId,
    type FabricExecutionPolicy,
    type FabricResolutionReceipt,
    type FabricVenue,
} from './contract';
import {
    buildObservabilitySnapshot,
    observeAndResolve,
    observeVenue,
    type VenueObservation,
} from './routing-observability';
import type { FabricResolution } from './resolver';

type FabricResolutionRequest = Parameters<typeof observeAndResolve>[1];

export type CandidateRoutingDenialCode =
    | 'venue_offline'
    | 'venue_unknown'
    | 'venue_degraded'
    | 'paired_trust_denied'
    | 'provider_onboarding_required'
    | 'provider_lifecycle_invalid'
    | 'provider_lifecycle_unavailable'
    | 'provider_receipt_mismatch'
    | 'fabric_resolution_denied';

export type CandidateRoutingDecision = Readonly<{
    schemaVersion: 'mediflow.ai.candidate-routing.v1';
    requestId: string;
    capability: FabricCapabilityId;
    requestedVenue: FabricVenue;
    outcome: 'resolved' | 'denied';
    denialCode: CandidateRoutingDenialCode | null;
    fallback: 'denied_by_contract';
    observations: readonly VenueObservation[];
    receipt: FabricResolutionReceipt | null;
}>;

export type CandidateRoutingInput = Readonly<{
    policy: FabricExecutionPolicy;
    request: FabricResolutionRequest;
    observations: readonly VenueObservation[];
    onboarding?: ProviderOnboardingState;
    lifecycle?: ProviderLifecycleState;
    reconnection?: PairingReconnectionClass;
}>;

export type HostCandidateRoutingInput = Omit<CandidateRoutingInput, 'onboarding' | 'lifecycle'>;

export type CandidateRoutingResult = Readonly<{
    decision: CandidateRoutingDecision;
    resolution: FabricResolution | null;
}>;

type CandidateDecisionContext = Readonly<{
    policy: FabricExecutionPolicy;
    request: FabricResolutionRequest;
    requestId: string;
    capability: FabricCapabilityId;
    requestedVenue: FabricVenue;
    descriptor: FabricCapabilityDescriptor;
}>;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VENUE_VALUES: ReadonlySet<string> = new Set(FABRIC_VENUES);

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function snapshotCandidateRoutingInput(input: CandidateRoutingInput): CandidateRoutingInput {
    if (!isRecord(input)) {
        throw new FabricPolicyError('policy_invalid');
    }
    // Snapshot every top-level caller-owned value once. Admission and receipt
    // checks must observe the same onboarding and lifecycle objects.
    return Object.freeze({
        policy: input.policy,
        request: input.request,
        observations: input.observations,
        onboarding: input.onboarding,
        lifecycle: input.lifecycle,
        reconnection: input.reconnection,
    });
}

function snapshotHostCandidateRoutingInput(input: HostCandidateRoutingInput): CandidateRoutingInput {
    if (!isRecord(input)) {
        throw new FabricPolicyError('policy_invalid');
    }
    return Object.freeze({
        policy: input.policy,
        request: input.request,
        observations: input.observations,
        reconnection: input.reconnection,
    });
}

function snapshotCandidateDecisionContext(input: CandidateRoutingInput): CandidateDecisionContext {
    // Copy each caller-owned input before inspecting it. This denies getters
    // that change identifiers after validation and keeps invalid values out of
    // the observable decision shape.
    const rawPolicy = input.policy;
    const rawRequest = input.request;
    if (!isRecord(rawPolicy) || !isRecord(rawRequest)) {
        throw new FabricPolicyError('policy_invalid');
    }

    const policySnapshot = { ...rawPolicy };
    const requestSnapshot = { ...rawRequest };
    const requestId = policySnapshot.requestId;
    const capability = policySnapshot.capability;
    const requestedVenue = requestSnapshot.venue;
    const requestedDescriptor = requestSnapshot.descriptor;
    if (
        typeof requestId !== 'string'
        || !REQUEST_ID_PATTERN.test(requestId)
        || typeof capability !== 'string'
        || typeof requestedVenue !== 'string'
        || !VENUE_VALUES.has(requestedVenue)
        || !requestedDescriptor
        || typeof requestedDescriptor !== 'object'
    ) {
        throw new FabricPolicyError('policy_invalid');
    }

    const descriptor = FABRIC_CAPABILITY_DESCRIPTORS[capability as FabricCapabilityId];
    if (!descriptor || requestedDescriptor !== descriptor) {
        throw new FabricPolicyError('policy_invalid');
    }

    return Object.freeze({
        policy: Object.freeze({
            ...policySnapshot,
            requestId,
            capability,
        }) as FabricExecutionPolicy,
        request: Object.freeze({
            ...requestSnapshot,
            descriptor,
            venue: requestedVenue,
        }) as FabricResolutionRequest,
        requestId,
        capability,
        requestedVenue: requestedVenue as FabricVenue,
        descriptor,
    });
}

function observationsFor(
    requestedVenue: FabricVenue,
    observations: readonly VenueObservation[],
): readonly VenueObservation[] {
    const snapshot = buildObservabilitySnapshot(observations).observations;
    if (snapshot.some((observation) => observation.venue === requestedVenue)) {
        return snapshot;
    }

    return buildObservabilitySnapshot([
        ...snapshot,
        observeVenue(requestedVenue, 'unknown', 'not_probed'),
    ]).observations;
}

function freezeDecision(
    context: CandidateDecisionContext,
    observations: readonly VenueObservation[],
    outcome: CandidateRoutingDecision['outcome'],
    denialCode: CandidateRoutingDecision['denialCode'],
    receipt: FabricResolutionReceipt | null,
): CandidateRoutingDecision {
    return Object.freeze({
        schemaVersion: 'mediflow.ai.candidate-routing.v1',
        requestId: context.requestId,
        capability: context.capability,
        requestedVenue: context.requestedVenue,
        outcome,
        denialCode,
        fallback: 'denied_by_contract',
        observations,
        receipt,
    });
}

function denied(
    context: CandidateDecisionContext,
    observations: readonly VenueObservation[],
    code: CandidateRoutingDenialCode,
): CandidateRoutingResult {
    return Object.freeze({
        decision: freezeDecision(context, observations, 'denied', code, null),
        resolution: null,
    });
}

function snapshotGenerativeAdmission(input: CandidateRoutingInput): ProviderLifecycleState | null {
    if (!input.onboarding || !input.lifecycle) return null;

    const admitted = admitProvider(input.onboarding);
    const lifecycle = snapshotProviderLifecycle(input.lifecycle);
    if (
        lifecycle.provider !== admitted.provider
        || lifecycle.credentialClass !== admitted.credentialClass
        || lifecycle.status !== 'available_unqualified'
    ) {
        return null;
    }

    return lifecycle;
}

function snapshotPersistedGenerativeAdmission(value: unknown): ProviderLifecycleState | null {
    const lifecycle = snapshotProviderLifecycle(value);
    return lifecycle.credentialClass === 'local_model'
        && lifecycle.status === 'available_unqualified'
        ? lifecycle
        : null;
}

function routeCandidateCapabilityWithAdmission(
    inputSnapshot: CandidateRoutingInput,
    snapshotAdmission: () => ProviderLifecycleState | null,
    mapsOnboardingErrors: boolean,
): CandidateRoutingResult {
    const context = snapshotCandidateDecisionContext(inputSnapshot);
    const observations = observationsFor(context.requestedVenue, inputSnapshot.observations);
    const requestedObservation = observations.find(
        (observation) => observation.venue === context.requestedVenue,
    );
    if (!requestedObservation) {
        return denied(context, observations, 'venue_unknown');
    }

    switch (requestedObservation.state) {
        case 'offline':
            return denied(context, observations, 'venue_offline');
        case 'unknown':
            return denied(context, observations, 'venue_unknown');
        case 'degraded':
            return denied(context, observations, 'venue_degraded');
        case 'available':
            break;
    }

    if (context.requestedVenue === 'home_base' && inputSnapshot.reconnection !== 'trusted') {
        return denied(context, observations, 'paired_trust_denied');
    }

    let admittedLifecycle: ProviderLifecycleState | null = null;
    if (context.descriptor.class === 'generative') {
        try {
            admittedLifecycle = snapshotAdmission();
            if (!admittedLifecycle) {
                return denied(context, observations, 'provider_lifecycle_unavailable');
            }
        } catch (error) {
            if (error instanceof ProviderLifecycleError) {
                return denied(
                    context,
                    observations,
                    mapsOnboardingErrors && (error.code === 'onboarding_not_enabled'
                        || error.code === 'credential_class_forbidden'
                        || error.code === 'egress_profile_unsatisfied')
                        ? 'provider_onboarding_required'
                        : 'provider_lifecycle_invalid',
                );
            }
            throw error;
        }
    }

    const routed = observeAndResolve(
        context.policy,
        context.request,
        observations,
    );
    if (!routed.resolution || !routed.decision.receipt) {
        return denied(context, observations, 'fabric_resolution_denied');
    }

    if (context.descriptor.class === 'generative') {
        const lifecycle = admittedLifecycle;
        const receipt = routed.decision.receipt;
        if (
            !lifecycle
            || receipt.provider !== lifecycle.provider
            || (receipt.providerReceipt !== null
                && receipt.providerReceipt.provider !== lifecycle.provider)
        ) {
            return denied(context, observations, 'provider_receipt_mismatch');
        }
    }

    return Object.freeze({
        decision: freezeDecision(
            context,
            observations,
            'resolved',
            null,
            routed.decision.receipt,
        ),
        resolution: routed.resolution,
    });
}

/**
 * Candidate-only admission layer for ADR 0091. It composes the pure resolver
 * with provider lifecycle and paired trust, but introduces no provider call,
 * persistence, credential handling, or fallback selection.
 */
export function routeCandidateCapability(
    input: CandidateRoutingInput,
): CandidateRoutingResult {
    const inputSnapshot = snapshotCandidateRoutingInput(input);
    return routeCandidateCapabilityWithAdmission(
        inputSnapshot,
        () => snapshotGenerativeAdmission(inputSnapshot),
        true,
    );
}

export function routeHostCandidateCapability(
    input: HostCandidateRoutingInput,
    lifecycle: ProviderLifecycleState,
): CandidateRoutingResult {
    const inputSnapshot = snapshotHostCandidateRoutingInput(input);
    return routeCandidateCapabilityWithAdmission(
        inputSnapshot,
        () => snapshotPersistedGenerativeAdmission(lifecycle),
        false,
    );
}
