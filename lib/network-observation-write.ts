/* @Codex: paired observation boundary delegates ordinary writes to the single required-audit operation. */
import { v4 as uuidv4 } from 'uuid';
import { requestIdFromRequest } from './security/audit';
import { normalizeObservationCreateInput, normalizeObservationUpdateInput } from './api-v1-clinical-write-normalization';
import type { NetworkWriteContext } from './network-write-context';
import { createObservationOperation, updateObservationOperation } from './observation-write-operation';
import { observationChangedFields, observationJsonObject, safeObservationExpectedVersion,
    validateObservationInput } from './observation-write-input';
import { isSealedValue, validateNetworkDeletionReason } from './network-patient-lifecycle';

export const NETWORK_OBSERVATION_WRITE_CAPABILITY = 'network.replica.write-observations';
type MutationResponse = { status: 200 | 201 | 400 | 403 | 404 | 409 | 422; value: Record<string, unknown> };
type MutationContext = NetworkWriteContext & { patientId: string };
type UpdateContext = MutationContext & { observationId: string };
const FORBIDDEN_WRITE_FIELDS = new Set(['aiSummary', 'documentInsights', 'documentInsightId', 'sourceDocumentId']);
const FORBIDDEN_CREATE_FIELDS = new Set(['patientId', 'createdAt', 'updatedAt', 'version', 'deletedAt', 'deletionReason']);
const FORBIDDEN_UPDATE_FIELDS = new Set(['patientId', 'createdAt', 'updatedAt']);
const hasOwn = (input: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(input, key);

function boundaryError(body: Record<string, unknown>, forbidden: Set<string>): MutationResponse | null {
    for (const field of FORBIDDEN_WRITE_FIELDS) if (hasOwn(body, field)) return {
        status: 403, value: { error: 'Network observation write boundary excludes AI/document-derived fields' },
    };
    for (const field of forbidden) if (hasOwn(body, field)) return {
        status: 400, value: { error: `Network observation write boundary rejects client-controlled ${field}` },
    };
    if (body.notes !== undefined && body.notes !== null && !isSealedValue(body.notes)) return {
        status: 400, value: { error: 'Network observation notes must be sealed with ENC:' },
    };
    const reason = validateNetworkDeletionReason(body.deletionReason);
    return reason.ok ? null : reason;
}

function auditFor(context: MutationContext) {
    return { actorType: 'user' as const, actorRef: context.session.userId,
        sourceSurface: 'native' as const, requestId: requestIdFromRequest(context.request),
        flags: ['auth:paired-client', `paired-client:${context.pairedClient.clientId}`, 'scope:ambulatory'] };
}

export async function createNetworkScopedObservation(context: MutationContext, value: unknown): Promise<MutationResponse> {
    const body = observationJsonObject(value);
    if (!body) return { status: 400, value: { error: 'Invalid JSON body' } };
    const boundary = boundaryError(body, FORBIDDEN_CREATE_FIELDS);
    if (boundary) return boundary;
    const shape = validateObservationInput(body, 'network', 'create');
    if (shape) return { status: shape.status, value: { error: shape.error } };
    const observationId = hasOwn(body, 'id') ? body.id as string : uuidv4();
    const normalized = normalizeObservationCreateInput(body, { id: observationId, patientId: context.patientId });
    if (!normalized.ok) return { status: 400, value: { error: normalized.error } };
    return createObservationOperation({
        patientId: context.patientId, observationId, values: normalized.values, mode: 'network',
        scopeAmbulatoryId: context.scopeAmbulatoryId,
        changedFields: observationChangedFields(normalized.values, body), audit: auditFor(context),
    });
}

export async function updateNetworkScopedObservation(context: UpdateContext, value: unknown): Promise<MutationResponse> {
    const body = observationJsonObject(value);
    if (!body) return { status: 400, value: { error: 'Invalid JSON body' } };
    const expectedVersion = safeObservationExpectedVersion(body.version);
    if (expectedVersion === null) return { status: 400, value: { error: 'Version is required' } };
    const boundary = boundaryError(body, FORBIDDEN_UPDATE_FIELDS);
    if (boundary) return boundary;
    const shape = validateObservationInput(body, 'network', 'update');
    if (shape) return { status: shape.status, value: { error: shape.error } };
    const normalized = normalizeObservationUpdateInput(body);
    if (!normalized.ok) return { status: 400, value: { error: normalized.error } };
    return updateObservationOperation({
        patientId: context.patientId, observationId: context.observationId, expectedVersion,
        values: normalized.values, mode: 'network', scopeAmbulatoryId: context.scopeAmbulatoryId,
        changedFields: observationChangedFields(normalized.values, body), audit: auditFor(context),
    });
}
