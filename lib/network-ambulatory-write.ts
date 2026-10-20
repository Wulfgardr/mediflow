/* paired adapters use the same admitted transaction and audit owner. */
import type { NetworkWriteContext } from './network-write-context';
import type { NetworkPatientCommitGuard } from './network-patient-commit-authority';
import { clearAmbulatory, createAmbulatory, deleteAmbulatory, updateAmbulatory, type AmbulatoryMutationResponse } from './ambulatory-write';

export const NETWORK_AMBULATORY_WRITE_CAPABILITY = 'network.ambulatories.write';

/* the route prepares the async guard before these synchronous commit paths. */
export async function createNetworkAmbulatory(
    context: NetworkWriteContext,
    body: Record<string, unknown>,
    authorizeCommit?: NetworkPatientCommitGuard,
): Promise<AmbulatoryMutationResponse> {
    return createAmbulatory(context, body, 'network', authorizeCommit);
}

export async function updateNetworkAmbulatory(
    context: NetworkWriteContext,
    id: string,
    body: Record<string, unknown>,
    authorizeCommit?: NetworkPatientCommitGuard,
): Promise<AmbulatoryMutationResponse> {
    return updateAmbulatory(context, id, body, 'network', authorizeCommit);
}

export async function deleteNetworkAmbulatory(
    context: NetworkWriteContext,
    id: string,
    body: Record<string, unknown>,
    authorizeCommit?: NetworkPatientCommitGuard,
): Promise<AmbulatoryMutationResponse> {
    return deleteAmbulatory(context, id, body.version, 'network', authorizeCommit);
}

export async function clearNetworkAmbulatory(
    context: NetworkWriteContext,
    ambulatoryId: string,
    body: Record<string, unknown>,
    authorizeCommit?: NetworkPatientCommitGuard,
): Promise<AmbulatoryMutationResponse> {
    return clearAmbulatory(context, ambulatoryId, body.version, 'network', authorizeCommit);
}
