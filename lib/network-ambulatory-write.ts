/* paired adapters use the same admitted transaction and audit owner. */
import type { NetworkWriteContext } from './network-write-context';
import { prepareNetworkPatientCommitGuard } from './network-patient-commit-authority';
import { createAmbulatory, updateAmbulatory, type AmbulatoryMutationResponse } from './ambulatory-write';

export const NETWORK_AMBULATORY_WRITE_CAPABILITY = 'network.ambulatories.write';

/* the network writer carries the async guard into the admitted core context. */
export async function createNetworkAmbulatory(
    context: NetworkWriteContext,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    return createAmbulatory({ ...context, authorizeCommit: await prepareNetworkPatientCommitGuard(
        context, NETWORK_AMBULATORY_WRITE_CAPABILITY) }, body, 'network');
}

export async function updateNetworkAmbulatory(
    context: NetworkWriteContext,
    id: string,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    return updateAmbulatory({ ...context, authorizeCommit: await prepareNetworkPatientCommitGuard(
        context, NETWORK_AMBULATORY_WRITE_CAPABILITY) }, id, body, 'network');
}
