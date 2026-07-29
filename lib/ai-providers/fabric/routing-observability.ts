/* @Codex */
import {
    FABRIC_VENUES,
    FabricPolicyError,
    type FabricCapabilityId,
    type FabricExecutionPolicy,
    type FabricPolicyErrorCode,
    type FabricResolutionReceipt,
    type FabricVenue,
} from './contract';
import {
    ProviderRegistryError,
    type ProviderRegistryErrorCode,
} from '../registry';
import {
    resolveFabricCapability,
    type FabricResolution,
} from './resolver';

export const VENUE_OBSERVATION_REASONS = Object.freeze([
    'target_invalid',
    'daemon_unreachable',
    'mode_disabled',
    'egress_profile_closed',
    'not_implemented',
    'not_probed',
] as const);

export type VenueObservationReason = typeof VENUE_OBSERVATION_REASONS[number];
export type VenueObservationState = 'available' | 'degraded' | 'offline' | 'unknown';

export type VenueObservation = Readonly<{
    venue: FabricVenue;
    state: VenueObservationState;
    reason: VenueObservationReason | null;
}>;

export type RoutingDecision = Readonly<{
    schemaVersion: 'mediflow.ai.routing-decision.v1';
    requestId: string;
    capability: FabricCapabilityId;
    requestedVenue: FabricVenue;
    outcome: 'resolved' | 'denied';
    denialCode:
        | FabricPolicyErrorCode
        | ProviderRegistryErrorCode
        | 'venue_offline'
        | 'venue_unknown'
        | 'venue_degraded'
        | null;
    fallback: 'denied_by_contract';
    observations: readonly VenueObservation[];
    receipt: FabricResolutionReceipt | null;
}>;

export type FabricObservabilitySnapshot = Readonly<{
    schemaVersion: 'mediflow.ai.fabric-observability.v1';
    fallback: 'denied_by_contract';
    observations: readonly VenueObservation[];
}>;

type FabricResolutionRequest = Parameters<typeof resolveFabricCapability>[1];

export type ObserveAndResolveResult = Readonly<{
    decision: RoutingDecision;
    resolution: FabricResolution | null;
    error: unknown | null;
}>;

const VENUE_VALUES: ReadonlySet<string> = new Set(FABRIC_VENUES);
const OBSERVATION_STATE_VALUES: ReadonlySet<string> = new Set([
    'available',
    'degraded',
    'offline',
    'unknown',
]);
const OBSERVATION_REASON_VALUES: ReadonlySet<string> = new Set(VENUE_OBSERVATION_REASONS);
const VENUE_ORDER: ReadonlyMap<FabricVenue, number> = new Map(
    FABRIC_VENUES.map((venue, index) => [venue, index]),
);

export function observeVenue(
    venue: FabricVenue,
    state: VenueObservationState,
    reason: VenueObservationReason | null,
): VenueObservation {
    const hasValidReason = reason === null || OBSERVATION_REASON_VALUES.has(reason);
    const requiresReason = state === 'offline' || state === 'unknown';
    if (
        !VENUE_VALUES.has(venue)
        || !OBSERVATION_STATE_VALUES.has(state)
        || !hasValidReason
        || (requiresReason && reason === null)
    ) {
        throw new FabricPolicyError('policy_invalid');
    }

    return Object.freeze({ venue, state, reason });
}

function snapshotObservations(observations: readonly VenueObservation[]): VenueObservation[] {
    if (!Array.isArray(observations)) {
        throw new FabricPolicyError('policy_invalid');
    }

    const snapshot = Array.from(observations);
    const venues = new Set<FabricVenue>();
    return snapshot.map((observation) => {
        if (!observation || typeof observation !== 'object') {
            throw new FabricPolicyError('policy_invalid');
        }
        const normalized = observeVenue(observation.venue, observation.state, observation.reason);
        if (venues.has(normalized.venue)) {
            throw new FabricPolicyError('policy_invalid');
        }
        venues.add(normalized.venue);
        return normalized;
    });
}

function freezeDecision(decision: RoutingDecision): RoutingDecision {
    if (decision.receipt) {
        if (decision.receipt.providerReceipt) {
            Object.freeze(decision.receipt.providerReceipt);
        }
        Object.freeze(decision.receipt.egressProfile);
        Object.freeze(decision.receipt);
    }
    Object.freeze(decision.observations);
    return Object.freeze(decision);
}

function buildDecision(
    policy: FabricExecutionPolicy,
    request: FabricResolutionRequest,
    observations: readonly VenueObservation[],
    result: Readonly<{
        outcome: RoutingDecision['outcome'];
        denialCode: RoutingDecision['denialCode'];
        receipt: FabricResolutionReceipt | null;
    }>,
): RoutingDecision {
    return freezeDecision({
        schemaVersion: 'mediflow.ai.routing-decision.v1',
        requestId: policy.requestId,
        capability: policy.capability,
        requestedVenue: request.venue,
        outcome: result.outcome,
        denialCode: result.denialCode,
        fallback: 'denied_by_contract',
        observations,
        receipt: result.receipt,
    });
}

export function buildObservabilitySnapshot(
    observations: readonly VenueObservation[],
): FabricObservabilitySnapshot {
    const ordered = snapshotObservations(observations)
        .sort((left, right) => (
            (VENUE_ORDER.get(left.venue) ?? Number.MAX_SAFE_INTEGER)
            - (VENUE_ORDER.get(right.venue) ?? Number.MAX_SAFE_INTEGER)
        ));

    return Object.freeze({
        schemaVersion: 'mediflow.ai.fabric-observability.v1',
        fallback: 'denied_by_contract',
        observations: Object.freeze(ordered),
    });
}

export function observeAndResolve(
    policy: FabricExecutionPolicy,
    request: FabricResolutionRequest,
    observations: readonly VenueObservation[],
): ObserveAndResolveResult {
    const observationSnapshot = snapshotObservations(observations);
    let requestedObservation = observationSnapshot.find(
        (observation) => observation.venue === request.venue,
    );
    if (!requestedObservation) {
        requestedObservation = observeVenue(request.venue, 'unknown', 'not_probed');
        observationSnapshot.push(requestedObservation);
    }
    const frozenObservations = Object.freeze(observationSnapshot);

    // ADR 0091: una venue non osservata, offline o degradata non puo'
    // raggiungere il resolver puro. Il routing candidato non sceglie mai una
    // venue alternativa e conserva sempre quella richiesta.
    if (requestedObservation.state === 'unknown') {
        return Object.freeze({
            decision: buildDecision(policy, request, frozenObservations, {
                outcome: 'denied',
                denialCode: 'venue_unknown',
                receipt: null,
            }),
            resolution: null,
            error: null,
        });
    }

    if (requestedObservation.state === 'offline') {
        return Object.freeze({
            decision: buildDecision(policy, request, frozenObservations, {
                outcome: 'denied',
                denialCode: 'venue_offline',
                receipt: null,
            }),
            resolution: null,
            error: null,
        });
    }

    if (requestedObservation.state === 'degraded') {
        return Object.freeze({
            decision: buildDecision(policy, request, frozenObservations, {
                outcome: 'denied',
                denialCode: 'venue_degraded',
                receipt: null,
            }),
            resolution: null,
            error: null,
        });
    }

    try {
        const resolution = resolveFabricCapability(policy, request);
        return Object.freeze({
            decision: buildDecision(policy, request, frozenObservations, {
                outcome: 'resolved',
                denialCode: null,
                receipt: resolution.receipt,
            }),
            resolution,
            error: null,
        });
    } catch (error) {
        if (error instanceof FabricPolicyError || error instanceof ProviderRegistryError) {
            return Object.freeze({
                decision: buildDecision(policy, request, frozenObservations, {
                    outcome: 'denied',
                    denialCode: error.code,
                    receipt: null,
                }),
                resolution: null,
                error,
            });
        }
        throw error;
    }
}
