/* @Codex */
import {
    FabricPolicyError,
    type FabricCapabilityDescriptor,
    type FabricCapabilityId,
} from './contract';
import { DETERMINISTIC_CAPABILITY_DESCRIPTORS } from './deterministic-catalog';
import { GENERATIVE_CAPABILITY_DESCRIPTORS } from './generative-catalog';

export const FABRIC_CAPABILITY_DESCRIPTORS: Readonly<
    Record<FabricCapabilityId, FabricCapabilityDescriptor>
> = Object.freeze({
    ...GENERATIVE_CAPABILITY_DESCRIPTORS,
    ...DETERMINISTIC_CAPABILITY_DESCRIPTORS,
});

export function getFabricCapabilityDescriptor(id: string): FabricCapabilityDescriptor {
    if (!Object.hasOwn(FABRIC_CAPABILITY_DESCRIPTORS, id)) {
        throw new FabricPolicyError('capability_unknown');
    }
    return FABRIC_CAPABILITY_DESCRIPTORS[id as FabricCapabilityId];
}
