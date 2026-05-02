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
} from './audit';
/* @Codex */
import { normalizeTherapyCreateInput, normalizeTherapyUpdateInput } from './api-v1-clinical-write-normalization';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import type { NetworkWriteContext } from './network-write-context';
/* @Codex */
import { patientsToAmbulatories, therapies } from './schema';
/* @Codex */
import { buildTherapyVersionConflictPayload, parseTherapyExpectedVersion } from './therapy-concurrency';

/* @Codex */
export const NETWORK_THERAPY_WRITE_CAPABILITY = 'network.replica.write-therapies';

type NetworkTherapyMutationResponse =
    | { status: 200; value: { success: true } }
    | { status: 201; value: { id: string; version: number } }
    | { status: 400 | 403 | 404 | 409; value: Record<string, unknown> };

type NetworkTherapyMutationContext = NetworkWriteContext & {
    patientId: string;
};

type NetworkTherapyUpdateContext = NetworkTherapyMutationContext & {
    therapyId: string;
};

const NETWORK_FORBIDDEN_THERAPY_WRITE_FIELDS = new Set([
    'aiSummary',
    'documentInsights',
    'documentInsightId',
    'sourceDocumentId',
]);
const NETWORK_FORBIDDEN_THERAPY_CREATE_FIELDS = new Set(['patientId', 'createdAt', 'updatedAt', 'version', 'deletedAt', 'deletionReason']);
const NETWORK_FORBIDDEN_THERAPY_UPDATE_FIELDS = new Set(['patientId', 'createdAt', 'updatedAt']);

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

function therapyIsInScope(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    context: NetworkTherapyUpdateContext
): typeof therapies.$inferSelect | null {
    const row = tx
        .select({ therapy: therapies })
        .from(therapies)
        .innerJoin(patientsToAmbulatories, eq(therapies.patientId, patientsToAmbulatories.patientId))
        .where(and(
            eq(therapies.id, context.therapyId),
            eq(therapies.patientId, context.patientId),
            eq(patientsToAmbulatories.ambulatoryId, context.scopeAmbulatoryId),
        ))
        .get();

    return row?.therapy ?? null;
}

function selectTherapyConflictSnapshot(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    context: NetworkTherapyUpdateContext
) {
    return tx
        .select({
            id: therapies.id,
            patientId: therapies.patientId,
            version: therapies.version,
            updatedAt: therapies.updatedAt,
            deletedAt: therapies.deletedAt,
        })
        .from(therapies)
        .where(and(eq(therapies.id, context.therapyId), eq(therapies.patientId, context.patientId)))
        .get() ?? null;
}

async function writeNetworkTherapyAuditEvent(input: {
    context: NetworkTherapyMutationContext | NetworkTherapyUpdateContext;
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
            subjectType: 'therapy',
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
        console.error('[MediFlow] Network therapy audit write failed:', error);
    }
}

/* @Codex */
export async function createNetworkScopedTherapy(
    context: NetworkTherapyMutationContext,
    body: Record<string, unknown>
): Promise<NetworkTherapyMutationResponse> {
    const boundaryError = validateNetworkTherapyMutationBoundary(body, NETWORK_FORBIDDEN_THERAPY_CREATE_FIELDS);
    if (boundaryError) return boundaryError;

    const newId = typeof body.id === 'string' && body.id.trim().length > 0 ? body.id : uuidv4();
    const normalized = normalizeTherapyCreateInput(body, {
        id: newId,
        patientId: context.patientId,
    });
    if (!normalized.ok) {
        return { status: 400, value: { error: normalized.error } };
    }

    const commit = dbServer.transaction((tx): NetworkTherapyMutationResponse => {
        if (!patientIsInScope(tx, context.patientId, context.scopeAmbulatoryId)) {
            return { status: 404, value: { error: 'Not found' } };
        }

        tx.insert(therapies).values(normalized.values).run();
        return { status: 201, value: { id: normalized.values.id, version: 1 } };
    });

    if (commit.status !== 201) return commit;

    await writeNetworkTherapyAuditEvent({
        context,
        eventType: 'therapy.created',
        subjectRef: commit.value.id,
        metadata: {
            changedFields: listChangedFields(body, ['id']),
            resourceVersion: 1,
        },
    });

    return commit;
}

/* @Codex */
export async function updateNetworkScopedTherapy(
    context: NetworkTherapyUpdateContext,
    body: Record<string, unknown>
): Promise<NetworkTherapyMutationResponse> {
    const expectedVersion = parseTherapyExpectedVersion(body.version);
    if (expectedVersion === null) {
        return { status: 400, value: { error: 'Version is required' } };
    }

    const boundaryError = validateNetworkTherapyMutationBoundary(body, NETWORK_FORBIDDEN_THERAPY_UPDATE_FIELDS);
    if (boundaryError) return boundaryError;

    const normalized = normalizeTherapyUpdateInput(body);
    if (!normalized.ok) {
        return { status: 400, value: { error: normalized.error } };
    }

    const commit = dbServer.transaction((tx): NetworkTherapyMutationResponse => {
        const existing = therapyIsInScope(tx, context);
        if (!existing) {
            return { status: 404, value: { error: 'Not found' } };
        }

        const updateResult = tx.update(therapies)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(
                eq(therapies.id, context.therapyId),
                eq(therapies.patientId, context.patientId),
                eq(therapies.version, expectedVersion),
            ))
            .run();

        if (updateResult.changes === 0) {
            return {
                status: 409,
                value: buildTherapyVersionConflictPayload(
                    expectedVersion,
                    context.therapyId,
                    selectTherapyConflictSnapshot(tx, context),
                ),
            };
        }

        return { status: 200, value: { success: true } };
    });

    if (commit.status !== 200) return commit;

    const isSoftDelete = hasOwn(body, 'deletedAt') && normalized.values.deletedAt !== null;
    await writeNetworkTherapyAuditEvent({
        context,
        eventType: isSoftDelete ? 'therapy.deleted' : 'therapy.updated',
        subjectRef: context.therapyId,
        metadata: {
            changedFields: listChangedFields(body, ['version']),
            resourceVersion: expectedVersion + 1,
        },
    });

    return commit;
}
