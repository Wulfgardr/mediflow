/* @Codex */
import { isEgressGateOpen } from '../../ai-egress-gate';
import {
    EGRESS_PROFILES,
    FABRIC_SCHEMA_VERSION,
    type EgressProfile,
    type FabricAvailabilityDisposition,
    type FabricCapabilityId,
    type FabricOperation,
    type FabricReviewPolicy,
    type FabricVenue,
} from './contract';
import { FABRIC_CAPABILITY_DESCRIPTORS } from './catalog';

type FabricStatusCapability = Readonly<{
    id: FabricCapabilityId;
    class: 'generative' | 'deterministic';
    operation: FabricOperation;
    review: FabricReviewPolicy;
    availabilityDisposition: FabricAvailabilityDisposition;
    venues: readonly FabricVenue[];
    egressProfile: Readonly<Pick<EgressProfile, 'id' | 'version' | 'egress'>>;
    killSwitch: string | null;
    contractSchema: string | null;
}>;

export type FabricStatusSnapshot = Readonly<{
    schemaVersion: 'mediflow.ai.fabric-status.v1';
    contractVersion: typeof FABRIC_SCHEMA_VERSION;
    egressGateOpen: boolean;
    readinessNote: 'available_unqualified';
    capabilities: readonly FabricStatusCapability[];
}>;

export function buildFabricStatusSnapshot(): FabricStatusSnapshot {
    const capabilities = Object.values(FABRIC_CAPABILITY_DESCRIPTORS)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((descriptor) => {
            const profile = EGRESS_PROFILES[descriptor.egressProfileId];
            return Object.freeze({
                id: descriptor.id,
                class: descriptor.class,
                operation: descriptor.operation,
                review: descriptor.review,
                availabilityDisposition: descriptor.availabilityDisposition,
                venues: Object.freeze([...descriptor.venues]),
                egressProfile: Object.freeze({
                    id: profile.id,
                    version: profile.version,
                    egress: profile.egress,
                }),
                killSwitch: descriptor.killSwitch,
                contractSchema: descriptor.contractSchema,
            });
        });

    return Object.freeze({
        schemaVersion: 'mediflow.ai.fabric-status.v1',
        contractVersion: FABRIC_SCHEMA_VERSION,
        egressGateOpen: isEgressGateOpen(),
        readinessNote: 'available_unqualified',
        capabilities: Object.freeze(capabilities),
    });
}
