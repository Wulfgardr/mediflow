/* @Codex */
import { isEgressGateOpen } from '../../ai-egress-gate';
import type { PairingReconnectionClass } from '../../network-pairing-lifecycle';
import {
    routeCandidateCapability,
    type CandidateRoutingDecision,
    type CandidateRoutingResult,
} from './candidate-router';
import type {
    FabricCapabilityDescriptor,
    FabricExecutionPolicy,
    FabricVenue,
} from './contract';
import { DETERMINISTIC_CAPABILITY_DESCRIPTORS } from './deterministic-catalog';
import { GENERATIVE_CAPABILITY_DESCRIPTORS } from './generative-catalog';
import {
    buildReviewedCandidateEnvelope,
    verifyLocalCandidateEnvelope,
    type LocalCandidateReviewedEnvelope,
} from './local-candidate-envelope';
import {
    advanceOnboarding,
    startOnboarding,
    type ProviderOnboardingState,
} from './onboarding';
import {
    admitProvider,
    transitionProviderLifecycle,
    type ProviderLifecycleState,
} from './provider-lifecycle';
import {
    observeVenue,
    type VenueObservation,
} from './routing-observability';

export const LOCAL_CANDIDATE_HARNESS_SCHEMA_VERSION =
    'mediflow.ai.local-candidate-harness.v1' as const;

export type { LocalCandidateReviewedEnvelope } from './local-candidate-envelope';

export type LocalCandidateHarnessReport = Readonly<{
    schemaVersion: typeof LOCAL_CANDIDATE_HARNESS_SCHEMA_VERSION;
    classification: 'synthetic_contract_harness';
    provider: Readonly<{
        onboarding: 'enabled';
        credentialClass: 'local_model';
        available: 'available_unqualified';
        degraded: 'degraded';
        revoked: 'revoked';
    }>;
    decisions: Readonly<{
        localProcess: CandidateRoutingDecision;
        homeBaseTrusted: CandidateRoutingDecision;
        localProcessOffline: CandidateRoutingDecision;
        providerDegraded: CandidateRoutingDecision;
        providerRevoked: CandidateRoutingDecision;
        homeBaseRevoked: CandidateRoutingDecision;
        homeBaseSessionExpired: CandidateRoutingDecision;
        onDevice: CandidateRoutingDecision;
        cloud: CandidateRoutingDecision;
        nonAiCore: CandidateRoutingDecision;
    }>;
    reviewed: LocalCandidateReviewedEnvelope;
    invariants: Readonly<{
        egressGateOpen: false;
        allFallbacksDenied: true;
        pairedExecutionGranted: false;
        clinicalWriteAuthorized: false;
        physicianReviewRequired: true;
        coreNonAiAvailable: true;
    }>;
}>;

const generative = GENERATIVE_CAPABILITY_DESCRIPTORS.patient_insight;
const deterministic = DETERMINISTIC_CAPABILITY_DESCRIPTORS.icd_lookup;

const syntheticBinding = Object.freeze({
    task: 'caller_value_is_ignored',
    provider: 'ollama',
    models: Object.freeze({
        clinical: 'qwen3.5:35b-a3b',
        reasoning: 'synthetic-reasoning-model',
        ocr: 'synthetic-ocr-model',
    }),
    endpoint: 'http://127.0.0.1:11434',
    chatTimeoutMs: 1_000,
});

function policyFor(
    descriptor: FabricCapabilityDescriptor,
    requestId: string,
): FabricExecutionPolicy {
    return Object.freeze({
        schemaVersion: 'mediflow.ai.execution-policy.v1',
        requestId,
        capability: descriptor.id,
        authorityPlane: 'clinical_application',
        operation: descriptor.operation,
        dataClass: descriptor.dataClass,
        allowedVenues: descriptor.venues,
        egressProfileId: descriptor.egressProfileId,
        consentRef: null,
        retention: 'not_persisted',
        review: descriptor.review,
        provenanceRequired: true,
        fallback: 'none',
    });
}

function enabledLocalOnboarding(): ProviderOnboardingState {
    const declared = startOnboarding('ollama', 'local_model');
    const configured = advanceOnboarding(declared, { type: 'configure' });
    const credentialed = advanceOnboarding(configured, { type: 'credential_declared' });
    const attested = advanceOnboarding(credentialed, { type: 'attest_local' });
    return advanceOnboarding(attested, { type: 'enable' });
}

function routeGenerative(
    requestId: string,
    venue: FabricVenue,
    observation: VenueObservation,
    onboarding: ProviderOnboardingState,
    lifecycle: ProviderLifecycleState,
    reconnection?: PairingReconnectionClass,
): CandidateRoutingResult {
    return routeCandidateCapability({
        policy: policyFor(generative, requestId),
        request: {
            descriptor: generative,
            venue,
            generative: syntheticBinding,
        },
        observations: [observation],
        onboarding,
        lifecycle,
        reconnection,
    });
}

export function runLocalCandidateHarness(): LocalCandidateHarnessReport {
    if (isEgressGateOpen()) {
        throw new Error('Synthetic local candidate requires the egress gate to stay closed');
    }

    const onboarding = enabledLocalOnboarding();
    const available = admitProvider(onboarding);
    const degraded = transitionProviderLifecycle(available, 'degrade');
    const revoked = transitionProviderLifecycle(available, 'revoke');

    const localProcess = routeGenerative(
        'synthetic-local-process',
        'local_process',
        observeVenue('local_process', 'available', null),
        onboarding,
        available,
    );
    const homeBaseTrusted = routeGenerative(
        'synthetic-home-base-trusted',
        'home_base',
        observeVenue('home_base', 'available', null),
        onboarding,
        available,
        'trusted',
    );
    const localProcessOffline = routeGenerative(
        'synthetic-local-process-offline',
        'local_process',
        observeVenue('local_process', 'offline', 'daemon_unreachable'),
        onboarding,
        available,
    );
    const providerDegraded = routeGenerative(
        'synthetic-provider-degraded',
        'local_process',
        observeVenue('local_process', 'available', null),
        onboarding,
        degraded,
    );
    const providerRevoked = routeGenerative(
        'synthetic-provider-revoked',
        'local_process',
        observeVenue('local_process', 'available', null),
        onboarding,
        revoked,
    );
    const homeBaseRevoked = routeGenerative(
        'synthetic-home-base-revoked',
        'home_base',
        observeVenue('home_base', 'available', null),
        onboarding,
        available,
        're_pairing_required',
    );
    const homeBaseSessionExpired = routeGenerative(
        'synthetic-home-base-session-expired',
        'home_base',
        observeVenue('home_base', 'available', null),
        onboarding,
        available,
        're_login_required',
    );
    const onDevice = routeGenerative(
        'synthetic-on-device',
        'on_device',
        observeVenue('on_device', 'unknown', 'not_implemented'),
        onboarding,
        available,
    );
    const cloud = routeGenerative(
        'synthetic-cloud',
        'cloud',
        observeVenue('cloud', 'offline', 'egress_profile_closed'),
        onboarding,
        available,
    );
    const nonAiCore = routeCandidateCapability({
        policy: policyFor(deterministic, 'synthetic-non-ai-core'),
        request: {
            descriptor: deterministic,
            venue: 'local_process',
        },
        observations: [observeVenue('local_process', 'available', null)],
    });

    const decisions = Object.freeze({
        localProcess: localProcess.decision,
        homeBaseTrusted: homeBaseTrusted.decision,
        localProcessOffline: localProcessOffline.decision,
        providerDegraded: providerDegraded.decision,
        providerRevoked: providerRevoked.decision,
        homeBaseRevoked: homeBaseRevoked.decision,
        homeBaseSessionExpired: homeBaseSessionExpired.decision,
        onDevice: onDevice.decision,
        cloud: cloud.decision,
        nonAiCore: nonAiCore.decision,
    });
    const allFallbacksDenied = Object.values(decisions)
        .every((decision) => decision.fallback === 'denied_by_contract');
    const coreNonAiAvailable = nonAiCore.decision.outcome === 'resolved'
        && nonAiCore.decision.receipt?.provider === 'in_house';
    if (
        onboarding.step !== 'enabled'
        || onboarding.credentialClass !== 'local_model'
        || available.status !== 'available_unqualified'
        || degraded.status !== 'degraded'
        || revoked.status !== 'revoked'
        || !allFallbacksDenied
        || !coreNonAiAvailable
    ) {
        throw new Error('Synthetic Fabric invariants were not satisfied');
    }

    const report = Object.freeze({
        schemaVersion: LOCAL_CANDIDATE_HARNESS_SCHEMA_VERSION,
        classification: 'synthetic_contract_harness' as const,
        provider: Object.freeze({
            onboarding: onboarding.step,
            credentialClass: onboarding.credentialClass,
            available: available.status,
            degraded: degraded.status,
            revoked: revoked.status,
        }),
        decisions,
        reviewed: buildReviewedCandidateEnvelope(
            localProcess,
            'synthetic-local-process',
        ),
        invariants: Object.freeze({
            egressGateOpen: false as const,
            allFallbacksDenied: true as const,
            pairedExecutionGranted: false as const,
            clinicalWriteAuthorized: false as const,
            physicianReviewRequired: true as const,
            coreNonAiAvailable: true as const,
        }),
    });

    if (!verifyLocalCandidateEnvelope(report.reviewed)) {
        throw new Error('Synthetic Fabric provenance and review binding failed');
    }
    return report;
}
