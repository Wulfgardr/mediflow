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
import { normalizeCheckupCreateInput, normalizeCheckupUpdateInput } from './api-v1-clinical-write-normalization';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import type { NetworkWriteContext } from './network-write-context';
/* @Codex */
import { patientsToAmbulatories, checkups } from './schema';
/* @Codex */
import { buildCheckupVersionConflictPayload, parseCheckupExpectedVersion } from './checkup-concurrency';
/* @Codex */
import { isSealedValue } from './network-patient-lifecycle';

/* @Codex */
export const NETWORK_CHECKUP_WRITE_CAPABILITY = 'network.replica.write-checkups';

type NetworkCheckupMutationResponse =
    | { status: 200; value: { success: true } }
    | { status: 201; value: { id: string; version: number } }
    | { status: 400 | 403 | 404 | 409; value: Record<string, unknown> };

type NetworkCheckupMutationContext = NetworkWriteContext & {
    patientId: string;
};

type NetworkCheckupUpdateContext = NetworkCheckupMutationContext & {
    checkupId: string;
};

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

function checkupIsInScope(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    context: NetworkCheckupUpdateContext
): typeof checkups.$inferSelect | null {
    const row = tx
        .select({ checkup: checkups })
        .from(checkups)
        .innerJoin(patientsToAmbulatories, eq(checkups.patientId, patientsToAmbulatories.patientId))
        .where(and(
            eq(checkups.id, context.checkupId),
            eq(checkups.patientId, context.patientId),
            eq(patientsToAmbulatories.ambulatoryId, context.scopeAmbulatoryId),
        ))
        .get();

    return row?.checkup ?? null;
}

function selectCheckupConflictSnapshot(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    context: NetworkCheckupUpdateContext
) {
    return tx
        .select({
            id: checkups.id,
            patientId: checkups.patientId,
            version: checkups.version,
            updatedAt: checkups.updatedAt,
            deletedAt: checkups.deletedAt,
        })
        .from(checkups)
        .where(and(eq(checkups.id, context.checkupId), eq(checkups.patientId, context.patientId)))
        .get() ?? null;
}

async function writeNetworkCheckupAuditEvent(input: {
    context: NetworkCheckupMutationContext | NetworkCheckupUpdateContext;
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
            subjectType: 'checkup',
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
        console.error('[MediFlow] Network checkup audit write failed:', error);
    }
}

/* @Codex */
export async function createNetworkScopedCheckup(
    context: NetworkCheckupMutationContext,
    body: Record<string, unknown>
): Promise<NetworkCheckupMutationResponse> {
    const boundaryError = validateNetworkCheckupMutationBoundary(body, NETWORK_FORBIDDEN_CHECKUP_CREATE_FIELDS);
    if (boundaryError) return boundaryError;

    const newId = typeof body.id === 'string' && body.id.trim().length > 0 ? body.id : uuidv4();
    const normalized = normalizeCheckupCreateInput(body, {
        id: newId,
        patientId: context.patientId,
    });
    if (!normalized.ok) {
        return { status: 400, value: { error: normalized.error } };
    }

    const commit = dbServer.transaction((tx): NetworkCheckupMutationResponse => {
        if (!patientIsInScope(tx, context.patientId, context.scopeAmbulatoryId)) {
            return { status: 404, value: { error: 'Not found' } };
        }

        tx.insert(checkups).values(normalized.values).run();
        return { status: 201, value: { id: normalized.values.id, version: 1 } };
    });

    if (commit.status !== 201) return commit;

    await writeNetworkCheckupAuditEvent({
        context,
        eventType: 'checkup.created',
        subjectRef: commit.value.id,
        metadata: {
            changedFields: listChangedFields(body, ['id']),
            resourceVersion: 1,
        },
    });

    return commit;
}

/* @Codex */
export async function updateNetworkScopedCheckup(
    context: NetworkCheckupUpdateContext,
    body: Record<string, unknown>
): Promise<NetworkCheckupMutationResponse> {
    const expectedVersion = parseCheckupExpectedVersion(body.version);
    if (expectedVersion === null) {
        return { status: 400, value: { error: 'Version is required' } };
    }

    const boundaryError = validateNetworkCheckupMutationBoundary(body, NETWORK_FORBIDDEN_CHECKUP_UPDATE_FIELDS);
    if (boundaryError) return boundaryError;

    const normalized = normalizeCheckupUpdateInput(body);
    if (!normalized.ok) {
        return { status: 400, value: { error: normalized.error } };
    }

    const commit = dbServer.transaction((tx): NetworkCheckupMutationResponse => {
        const existing = checkupIsInScope(tx, context);
        if (!existing) {
            return { status: 404, value: { error: 'Not found' } };
        }

        const updateResult = tx.update(checkups)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(
                eq(checkups.id, context.checkupId),
                eq(checkups.patientId, context.patientId),
                eq(checkups.version, expectedVersion),
            ))
            .run();

        if (updateResult.changes === 0) {
            return {
                status: 409,
                value: buildCheckupVersionConflictPayload(
                    expectedVersion,
                    context.checkupId,
                    selectCheckupConflictSnapshot(tx, context),
                ),
            };
        }

        return { status: 200, value: { success: true } };
    });

    if (commit.status !== 200) return commit;

    const isSoftDelete = hasOwn(body, 'deletedAt') && normalized.values.deletedAt !== null;
    await writeNetworkCheckupAuditEvent({
        context,
        eventType: isSoftDelete ? 'checkup.deleted' : 'checkup.updated',
        subjectRef: context.checkupId,
        metadata: {
            changedFields: listChangedFields(body, ['version']),
            resourceVersion: expectedVersion + 1,
        },
    });

    return commit;
}
