/* @Codex: paired checkup boundary preserves current capability, normalization and ENC semantics. */
import { v4 as uuidv4 } from 'uuid';
import { listChangedFields, requestIdFromRequest } from './security/audit';
import { normalizeCheckupCreateInput, normalizeCheckupUpdateInput } from './api-v1-clinical-write-normalization';
import type { NetworkWriteContext } from './network-write-context';
import { parseCheckupExpectedVersion } from './checkup-concurrency';
import { isSealedValue, validateNetworkDeletionReason } from './network-patient-lifecycle';
import { createCheckupOperation, updateCheckupOperation } from './checkup-write-operation';

export const NETWORK_CHECKUP_WRITE_CAPABILITY = 'network.replica.write-checkups';

type NetworkCheckupMutationResponse = { status: 200 | 201 | 400 | 403 | 404 | 409; value: Record<string, unknown> };

type NetworkCheckupMutationContext = NetworkWriteContext & { patientId: string };
type NetworkCheckupUpdateContext = NetworkCheckupMutationContext & { checkupId: string };

const NETWORK_FORBIDDEN_CHECKUP_WRITE_FIELDS = new Set([
    'aiSummary',
    'documentInsights',
    'documentInsightId',
    'sourceDocumentId',
]);
const NETWORK_FORBIDDEN_CHECKUP_CREATE_FIELDS = new Set(['patientId', 'createdAt', 'updatedAt', 'version', 'deletedAt', 'deletionReason']);
const NETWORK_FORBIDDEN_CHECKUP_UPDATE_FIELDS = new Set(['patientId', 'createdAt', 'updatedAt']);

function hasOwn(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

function validateNetworkCheckupMutationBoundary(
    body: Record<string, unknown>,
    forbiddenClientFields: Set<string>
): NetworkCheckupMutationResponse | null {
    for (const field of NETWORK_FORBIDDEN_CHECKUP_WRITE_FIELDS) {
        if (hasOwn(body, field)) {
            return {
                status: 403,
                value: {
                    error: 'Network checkup write boundary excludes AI/document-derived fields',
                },
            };
        }
    }

    for (const field of forbiddenClientFields) {
        if (hasOwn(body, field)) {
            return {
                status: 400,
                value: {
                    error: `Network checkup write boundary rejects client-controlled ${field}`,
                },
            };
        }
    }

    const notes = body.notes;
    if (notes !== undefined && notes !== null && !isSealedValue(notes)) {
        return {
            status: 400,
            value: {
                error: 'Network checkup notes must be sealed with ENC:',
            },
        };
    }

    const deletionReason = validateNetworkDeletionReason(body.deletionReason);
    if (!deletionReason.ok) return deletionReason;

    return null;
}


function requiredAuditContext(context: NetworkCheckupMutationContext) {
    return {
        actorType: 'user' as const,
        actorRef: context.session.userId,
        sourceSurface: 'native' as const,
        requestId: requestIdFromRequest(context.request),
        flags: ['auth:paired-client', `paired-client:${context.pairedClient.clientId}`, 'scope:ambulatory'],
    };
}

/* @Codex: boundary precedes shared IMMEDIATE admission, mutation and required audit. */
export async function createNetworkScopedCheckup(
    context: NetworkCheckupMutationContext, body: Record<string, unknown>
): Promise<NetworkCheckupMutationResponse> {
    const boundaryError = validateNetworkCheckupMutationBoundary(body, NETWORK_FORBIDDEN_CHECKUP_CREATE_FIELDS);
    if (boundaryError) return boundaryError;
    const newId = typeof body.id === 'string' && body.id.trim().length > 0 ? body.id : uuidv4();
    const normalized = normalizeCheckupCreateInput(body, { id: newId, patientId: context.patientId });
    if (!normalized.ok) return { status: 400, value: { error: normalized.error } };
    return createCheckupOperation({
        patientId: context.patientId, checkupId: normalized.values.id, values: normalized.values,
        changedFields: listChangedFields(body, ['id']), mode: 'network',
        scopeAmbulatoryId: context.scopeAmbulatoryId, audit: requiredAuditContext(context),
    });
}

export async function updateNetworkScopedCheckup(
    context: NetworkCheckupUpdateContext, body: Record<string, unknown>
): Promise<NetworkCheckupMutationResponse> {
    const expectedVersion = parseCheckupExpectedVersion(body.version);
    if (expectedVersion === null) return { status: 400, value: { error: 'Version is required' } };
    const boundaryError = validateNetworkCheckupMutationBoundary(body, NETWORK_FORBIDDEN_CHECKUP_UPDATE_FIELDS);
    if (boundaryError) return boundaryError;
    const normalized = normalizeCheckupUpdateInput(body);
    if (!normalized.ok) return { status: 400, value: { error: normalized.error } };
    return updateCheckupOperation({
        patientId: context.patientId, checkupId: context.checkupId, expectedVersion,
        values: normalized.values, changedFields: listChangedFields(body, ['version']), mode: 'network',
        scopeAmbulatoryId: context.scopeAmbulatoryId, audit: requiredAuditContext(context),
    });
}
