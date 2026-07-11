/* @Codex */
import { and, eq } from 'drizzle-orm';
/* @Codex */
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import {
    listChangedFields,
    requestIdFromRequest,
    writeAuditEvent,
    type AuditEventType,
    type AuditRedactedMetadata,
} from './security/audit';
/* @Codex */
import { normalizeObservationCreateInput, normalizeObservationUpdateInput } from './api-v1-clinical-write-normalization';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import type { NetworkWriteContext } from './network-write-context';
/* @Codex */
import { observations, patientsToAmbulatories } from './schema';
/* @Codex */
import { buildObservationVersionConflictPayload, parseObservationExpectedVersion } from './observation-concurrency';
/* @Codex */
import { isSealedValue } from './network-patient-lifecycle';

/* @Codex */
export const NETWORK_OBSERVATION_WRITE_CAPABILITY = 'network.replica.write-observations';

type NetworkObservationMutationResponse =
    | { status: 200; value: { success: true } }
    | { status: 201; value: { id: string; version: number } }
    | { status: 400 | 403 | 404 | 409; value: Record<string, unknown> };

type NetworkObservationMutationContext = NetworkWriteContext & {
    patientId: string;
};

type NetworkObservationUpdateContext = NetworkObservationMutationContext & {
    observationId: string;
};

const NETWORK_FORBIDDEN_OBSERVATION_WRITE_FIELDS = new Set([
    'aiSummary',
    'documentInsights',
    'documentInsightId',
    'sourceDocumentId',
]);
const NETWORK_FORBIDDEN_OBSERVATION_CREATE_FIELDS = new Set(['patientId', 'createdAt', 'updatedAt', 'version', 'deletedAt', 'deletionReason']);
const NETWORK_FORBIDDEN_OBSERVATION_UPDATE_FIELDS = new Set(['patientId', 'createdAt', 'updatedAt']);

function hasOwn(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

function validateNetworkObservationMutationBoundary(
    body: Record<string, unknown>,
    forbiddenClientFields: Set<string>
): NetworkObservationMutationResponse | null {
    for (const field of NETWORK_FORBIDDEN_OBSERVATION_WRITE_FIELDS) {
        if (hasOwn(body, field)) {
            return {
                status: 403,
                value: {
                    error: 'Network observation write boundary excludes AI/document-derived fields',
                },
            };
        }
    }

    for (const field of forbiddenClientFields) {
        if (hasOwn(body, field)) {
            return {
                status: 400,
                value: {
                    error: `Network observation write boundary rejects client-controlled ${field}`,
                },
            };
        }
    }

    const notes = body.notes;
    if (notes !== undefined && notes !== null && !isSealedValue(notes)) {
        return {
            status: 400,
            value: {
                error: 'Network observation notes must be sealed with ENC:',
            },
        };
    }

    return null;
}

function patientIsInScope(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    patientId: string,
    scopeAmbulatoryId: string
): boolean {
    const scopedPatient = tx
        .select({ patientId: patientsToAmbulatories.patientId })
        .from(patientsToAmbulatories)
        .where(and(
            eq(patientsToAmbulatories.patientId, patientId),
            eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
        ))
        .get();

    return Boolean(scopedPatient);
}

function observationIsInScope(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    context: NetworkObservationUpdateContext
): typeof observations.$inferSelect | null {
    const row = tx
        .select({ observation: observations })
        .from(observations)
        .innerJoin(patientsToAmbulatories, eq(observations.patientId, patientsToAmbulatories.patientId))
        .where(and(
            eq(observations.id, context.observationId),
            eq(observations.patientId, context.patientId),
            eq(patientsToAmbulatories.ambulatoryId, context.scopeAmbulatoryId),
        ))
        .get();

    return row?.observation ?? null;
}

function selectObservationConflictSnapshot(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    context: NetworkObservationUpdateContext
) {
    return tx
        .select({
            id: observations.id,
            patientId: observations.patientId,
            version: observations.version,
            updatedAt: observations.updatedAt,
            deletedAt: observations.deletedAt,
        })
        .from(observations)
        .where(and(eq(observations.id, context.observationId), eq(observations.patientId, context.patientId)))
        .get() ?? null;
}

async function writeNetworkObservationAuditEvent(input: {
    context: NetworkObservationMutationContext | NetworkObservationUpdateContext;
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
            subjectType: 'observation',
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
        console.error('[MediFlow] Network observation audit write failed:', error);
    }
}

/* @Codex */
export async function createNetworkScopedObservation(
    context: NetworkObservationMutationContext,
    body: Record<string, unknown>
): Promise<NetworkObservationMutationResponse> {
    const boundaryError = validateNetworkObservationMutationBoundary(body, NETWORK_FORBIDDEN_OBSERVATION_CREATE_FIELDS);
    if (boundaryError) return boundaryError;

    const newId = typeof body.id === 'string' && body.id.trim().length > 0 ? body.id : uuidv4();
    const normalized = normalizeObservationCreateInput(body, {
        id: newId,
        patientId: context.patientId,
    });
    if (!normalized.ok) {
        return { status: 400, value: { error: normalized.error } };
    }

    const commit = dbServer.transaction((tx): NetworkObservationMutationResponse => {
        if (!patientIsInScope(tx, context.patientId, context.scopeAmbulatoryId)) {
            return { status: 404, value: { error: 'Not found' } };
        }

        tx.insert(observations).values(normalized.values).run();
        return { status: 201, value: { id: normalized.values.id, version: 1 } };
    });

    if (commit.status !== 201) return commit;

    await writeNetworkObservationAuditEvent({
        context,
        eventType: 'observation.created',
        subjectRef: commit.value.id,
        metadata: {
            changedFields: listChangedFields(body, ['id']),
            resourceVersion: 1,
        },
    });

    return commit;
}

/* @Codex */
export async function updateNetworkScopedObservation(
    context: NetworkObservationUpdateContext,
    body: Record<string, unknown>
): Promise<NetworkObservationMutationResponse> {
    const expectedVersion = parseObservationExpectedVersion(body.version);
    if (expectedVersion === null) {
        return { status: 400, value: { error: 'Version is required' } };
    }

    const boundaryError = validateNetworkObservationMutationBoundary(body, NETWORK_FORBIDDEN_OBSERVATION_UPDATE_FIELDS);
    if (boundaryError) return boundaryError;

    const normalized = normalizeObservationUpdateInput(body);
    if (!normalized.ok) {
        return { status: 400, value: { error: normalized.error } };
    }

    const commit = dbServer.transaction((tx): NetworkObservationMutationResponse => {
        const existing = observationIsInScope(tx, context);
        if (!existing) {
            return { status: 404, value: { error: 'Not found' } };
        }

        const updateResult = tx.update(observations)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(
                eq(observations.id, context.observationId),
                eq(observations.patientId, context.patientId),
                eq(observations.version, expectedVersion),
            ))
            .run();

        if (updateResult.changes === 0) {
            return {
                status: 409,
                value: buildObservationVersionConflictPayload(
                    expectedVersion,
                    context.observationId,
                    selectObservationConflictSnapshot(tx, context),
                ),
            };
        }

        return { status: 200, value: { success: true } };
    });

    if (commit.status !== 200) return commit;

    const isSoftDelete = hasOwn(body, 'deletedAt') && normalized.values.deletedAt !== null;
    await writeNetworkObservationAuditEvent({
        context,
        eventType: isSoftDelete ? 'observation.deleted' : 'observation.updated',
        subjectRef: context.observationId,
        metadata: {
            changedFields: listChangedFields(body, ['version']),
            resourceVersion: expectedVersion + 1,
        },
    });

    return commit;
}
