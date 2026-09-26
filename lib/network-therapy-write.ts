/* @Codex: paired therapy boundary remains specific to this capability and routes. */
import { v4 as uuidv4 } from 'uuid';
import { normalizeTherapyCreateInput, normalizeTherapyUpdateInput } from './api-v1-clinical-write-normalization';
import { createTherapyOperation, updateTherapyOperation } from './therapy-write-operation';
import { safeTherapyExpectedVersion, therapyChangedFields, validateTherapyInput } from './therapy-write-input';
import { requestIdFromRequest } from './security/audit';
import type { NetworkWriteContext } from './network-write-context';
import { isSealedValue } from './network-patient-lifecycle';

export const NETWORK_THERAPY_WRITE_CAPABILITY = 'network.replica.write-therapies';
type NetworkTherapyMutationResponse =
    | { status: 200; value: { success: true } }
    | { status: 201; value: { id: string; version: number } }
    | { status: 400 | 403 | 404 | 409; value: Record<string, unknown> };
type NetworkTherapyMutationContext = NetworkWriteContext & { patientId: string };
type NetworkTherapyUpdateContext = NetworkTherapyMutationContext & { therapyId: string };

const NETWORK_FORBIDDEN_THERAPY_WRITE_FIELDS = new Set([
    'aiSummary',
    'documentInsights',
    'documentInsightId',
    'sourceDocumentId',
]);
const NETWORK_FORBIDDEN_THERAPY_CREATE_FIELDS = new Set(['patientId', 'createdAt', 'updatedAt', 'version', 'deletedAt', 'deletionReason']);
const NETWORK_FORBIDDEN_THERAPY_UPDATE_FIELDS = new Set(['patientId', 'createdAt', 'updatedAt']);
const NETWORK_THERAPY_SEALED_FIELDS = ['motivation', 'deletionReason'] as const;

function hasOwn(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

function validateNetworkTherapyMutationBoundary(
    body: Record<string, unknown>,
    forbiddenClientFields: Set<string>
): NetworkTherapyMutationResponse | null {
    for (const field of NETWORK_FORBIDDEN_THERAPY_WRITE_FIELDS) {
        if (hasOwn(body, field)) {
            return {
                status: 403,
                value: {
                    error: 'Network therapy write boundary excludes AI/document-derived fields',
                },
            };
        }
    }

    for (const field of forbiddenClientFields) {
        if (hasOwn(body, field)) {
            return {
                status: 400,
                value: {
                    error: `Network therapy write boundary rejects client-controlled ${field}`,
                },
            };
        }
    }

    for (const field of NETWORK_THERAPY_SEALED_FIELDS) {
        const value = body[field];
        if (value !== undefined && value !== null && !isSealedValue(value)) {
            return {
                status: 400,
                value: {
                    error: `Network therapy ${field} must be sealed with ENC:`,
                },
            };
        }
    }

    return null;
}

function networkAuditContext(context: NetworkTherapyMutationContext) {
    return {
        actorType: 'user' as const, actorRef: context.session.userId,
        sourceSurface: 'native' as const, requestId: requestIdFromRequest(context.request),
        flags: ['auth:paired-client', `paired-client:${context.pairedClient.clientId}`, 'scope:ambulatory'],
    };
}

/* @Codex */
export async function createNetworkScopedTherapy(
    context: NetworkTherapyMutationContext,
    body: Record<string, unknown>
): Promise<NetworkTherapyMutationResponse> {
    const boundaryError = validateNetworkTherapyMutationBoundary(body, NETWORK_FORBIDDEN_THERAPY_CREATE_FIELDS);
    if (boundaryError) return boundaryError;
    const shape = validateTherapyInput(body, 'network', 'create');
    if (shape) return { status: 400, value: { error: shape.error } };
    const newId = Object.prototype.hasOwnProperty.call(body, 'id') ? body.id as string : uuidv4();
    const normalized = normalizeTherapyCreateInput(body, { id: newId, patientId: context.patientId });
    if (!normalized.ok) return { status: 400, value: { error: normalized.error } };
    return createTherapyOperation({
        patientId: context.patientId, therapyId: newId, values: normalized.values,
        changedFields: therapyChangedFields(normalized.values, body),
        mode: 'network', scopeAmbulatoryId: context.scopeAmbulatoryId,
        audit: networkAuditContext(context),
    }) as NetworkTherapyMutationResponse;
}

/* @Codex */
export async function updateNetworkScopedTherapy(
    context: NetworkTherapyUpdateContext,
    body: Record<string, unknown>
): Promise<NetworkTherapyMutationResponse> {
    const expectedVersion = safeTherapyExpectedVersion(body.version);
    if (expectedVersion === null) return { status: 400, value: { error: 'Version is required' } };
    const boundaryError = validateNetworkTherapyMutationBoundary(body, NETWORK_FORBIDDEN_THERAPY_UPDATE_FIELDS);
    if (boundaryError) return boundaryError;
    const shape = validateTherapyInput(body, 'network', 'update');
    if (shape) return { status: 400, value: { error: shape.error } };
    const normalized = normalizeTherapyUpdateInput(body);
    if (!normalized.ok) return { status: 400, value: { error: normalized.error } };
    return updateTherapyOperation({
        patientId: context.patientId, therapyId: context.therapyId,
        expectedVersion, values: normalized.values,
        changedFields: therapyChangedFields(normalized.values, body),
        mode: 'network', scopeAmbulatoryId: context.scopeAmbulatoryId,
        audit: networkAuditContext(context),
    }) as NetworkTherapyMutationResponse;
}
