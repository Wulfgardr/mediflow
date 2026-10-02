/* @Codex: paired adapters use the same admitted transaction and audit owner. */
import type { NetworkWriteContext } from './network-write-context';
import { clearAmbulatory, createAmbulatory, deleteAmbulatory, updateAmbulatory, type AmbulatoryMutationResponse } from './ambulatory-write';

export const NETWORK_AMBULATORY_WRITE_CAPABILITY = 'network.ambulatories.write';

/* @Codex */
export async function createNetworkAmbulatory(
    context: NetworkWriteContext,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    return createAmbulatory(context, body, 'network');
}

/* @Codex */
export async function updateNetworkAmbulatory(
    context: NetworkWriteContext,
    id: string,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    return updateAmbulatory(context, id, body, 'network');
}

/* @Codex */
export async function deleteNetworkAmbulatory(
    context: NetworkWriteContext,
    id: string,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    return deleteAmbulatory(context, id, body.version, 'network');
}

/* @Codex */
export async function clearNetworkAmbulatory(
    context: NetworkWriteContext,
    ambulatoryId: string,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    return clearAmbulatory(context, ambulatoryId, body.version, 'network');
}
