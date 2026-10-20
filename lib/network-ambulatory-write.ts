/* paired adapters use the same admitted transaction and audit owner. */
import type { NetworkWriteContext } from './network-write-context';
import { prepareNetworkPatientCommitGuard } from './network-patient-commit-authority';
import { clearAmbulatory, createAmbulatory, deleteAmbulatory, updateAmbulatory, type AmbulatoryMutationResponse } from './ambulatory-write';

export const NETWORK_AMBULATORY_WRITE_CAPABILITY = 'network.ambulatories.write';

/* the network writer owns the async guard before its synchronous commit path. */
export async function createNetworkAmbulatory(
    context: NetworkWriteContext,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    const authorizeCommit = await prepareNetworkPatientCommitGuard(context, NETWORK_AMBULATORY_WRITE_CAPABILITY);
    return createAmbulatory(context, body, 'network', authorizeCommit);
}

export async function updateNetworkAmbulatory(
    context: NetworkWriteContext,
    id: string,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    const authorizeCommit = await prepareNetworkPatientCommitGuard(context, NETWORK_AMBULATORY_WRITE_CAPABILITY);
    return updateAmbulatory(context, id, body, 'network', authorizeCommit);
}

export async function deleteNetworkAmbulatory(
    context: NetworkWriteContext,
    id: string,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    const authorizeCommit = await prepareNetworkPatientCommitGuard(context, NETWORK_AMBULATORY_WRITE_CAPABILITY);
    return deleteAmbulatory(context, id, body.version, 'network', authorizeCommit);
}

export async function clearNetworkAmbulatory(
    context: NetworkWriteContext,
    ambulatoryId: string,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    const authorizeCommit = await prepareNetworkPatientCommitGuard(context, NETWORK_AMBULATORY_WRITE_CAPABILITY);
    return clearAmbulatory(context, ambulatoryId, body.version, 'network', authorizeCommit);
}
