import { listChangedFields, requestIdFromRequest, writeAuditEvent, type AuditEventType, type AuditRedactedMetadata } from './security/audit';
import type { NetworkWriteContext } from './network-write-context';
import { clearAmbulatory, createAmbulatory, deleteAmbulatory, updateAmbulatory, type AmbulatoryMutationResponse } from './ambulatory-write';

export const NETWORK_AMBULATORY_WRITE_CAPABILITY = 'network.ambulatories.write';

export async function writeNetworkAmbulatoryAuditEvent(input: {
    context: NetworkWriteContext;
    eventType: AuditEventType;
    subjectRef: string;
    metadata?: AuditRedactedMetadata | null;
}): Promise<void> {
    try {
        await writeAuditEvent({
            eventType: input.eventType,
            outcome: 'success',
            actorType: 'user',
            actorRef: input.context.session.userId,
            subjectType: 'ambulatory',
            subjectRef: input.subjectRef,
            sourceSurface: 'native',
            requestId: requestIdFromRequest(input.context.request),
            redactedMetadata: {
                ...(input.metadata ?? {}),
                flags: [
                    ...(input.metadata?.flags ?? []),
                    'auth:paired-client',
                    `paired-client:${input.context.pairedClient.clientId}`,
                    'scope:ambulatory',
                ],
            },
        });
    } catch (error) {
        console.error('[MediFlow] Network ambulatory audit write failed:', error);
    }
}

async function auditSuccessfulMutation(
    context: NetworkWriteContext,
    result: AmbulatoryMutationResponse,
    eventType: AuditEventType,
    subjectRef: string,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    if (result.status !== 200 && result.status !== 201) return result;
    await writeNetworkAmbulatoryAuditEvent({
        context,
        eventType,
        subjectRef,
        metadata: {
            changedFields: listChangedFields(body, ['version']),
            resourceVersion: typeof result.value.version === 'number' ? result.value.version : undefined,
        },
    });
    return result;
}

export async function createNetworkAmbulatory(
    context: NetworkWriteContext,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    const result = createAmbulatory(body);
    const id = typeof result.value.id === 'string' ? result.value.id : '';
    return id ? auditSuccessfulMutation(context, result, 'ambulatory.created', id, body) : result;
}

export async function updateNetworkAmbulatory(
    context: NetworkWriteContext,
    id: string,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    return auditSuccessfulMutation(context, updateAmbulatory(id, body), 'ambulatory.updated', id, body);
}

export async function deleteNetworkAmbulatory(
    context: NetworkWriteContext,
    id: string,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    return auditSuccessfulMutation(context, deleteAmbulatory(id, body.version), 'ambulatory.deleted', id, body);
}

export async function clearNetworkAmbulatory(
    context: NetworkWriteContext,
    ambulatoryId: string,
    body: Record<string, unknown>,
): Promise<AmbulatoryMutationResponse> {
    const result = await clearAmbulatory({ request: context.request, session: context.session }, ambulatoryId, body.version);
    return auditSuccessfulMutation(context, result, 'ambulatory.cleared', ambulatoryId, body);
}
