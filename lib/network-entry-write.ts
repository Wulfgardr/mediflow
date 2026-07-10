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
import { normalizeEntryCreateInput, normalizeEntryUpdateInput } from './api-v1-clinical-write-normalization';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import { buildEntryVersionConflictPayload, parseEntryExpectedVersion } from './entry-concurrency';
/* @Codex */
import { isSealedValue } from './network-patient-lifecycle';
/* @Codex */
import type { NetworkWriteContext } from './network-write-context';
/* @Codex */
import { entries, patientsToAmbulatories } from './schema';

/* @Codex */
export const NETWORK_ENTRY_WRITE_CAPABILITY = 'network.replica.write-clinical-diary';

type NetworkEntryMutationResponse =
    | { status: 200; value: { success: true } | { id: string; version: number; idempotent: true } }
    | { status: 201; value: { id: string; version: number } }
    | { status: 400 | 403 | 404 | 409; value: Record<string, unknown> };

type NetworkEntryMutationContext = NetworkWriteContext & {
    patientId: string;
};

type NetworkEntryUpdateContext = NetworkEntryMutationContext & {
    entryId: string;
};

type NormalizedNetworkEntryCreateValues = {
    type: string;
    title: string;
    date: Date;
    content: string;
    setting: string | null;
    metadata: string | null;
    attachments: string | null;
};

const NETWORK_FORBIDDEN_ENTRY_WRITE_FIELDS = new Set([
    'aiSummary',
    'documentInsights',
    'documentInsightId',
    'sourceDocumentId',
]);
const NETWORK_FORBIDDEN_ENTRY_CREATE_FIELDS = new Set(['patientId', 'createdAt', 'updatedAt', 'version']);
const NETWORK_FORBIDDEN_ENTRY_UPDATE_FIELDS = new Set(['patientId', 'createdAt', 'updatedAt']);

function hasOwn(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

function isEmptyAttachmentValue(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}

function validateNetworkEntryMutationBoundary(
    body: Record<string, unknown>,
    forbiddenClientFields: Set<string>
): NetworkEntryMutationResponse | null {
    for (const field of NETWORK_FORBIDDEN_ENTRY_WRITE_FIELDS) {
        if (hasOwn(body, field)) {
            return {
                status: 403,
                value: {
                    error: 'Network diary write boundary excludes AI/document-derived fields',
                },
            };
        }
    }

    for (const field of forbiddenClientFields) {
        if (hasOwn(body, field)) {
            return {
                status: 400,
                value: {
                    error: `Network diary write boundary rejects client-controlled ${field}`,
                },
            };
        }
    }

    if (hasOwn(body, 'attachments')
        && !isEmptyAttachmentValue(body.attachments)
        && !isSealedValue(body.attachments)) {
        return {
            status: 400,
            value: {
                error: 'Network diary attachment references must be sealed with ENC:',
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

function entryIsInScope(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    context: NetworkEntryUpdateContext
): typeof entries.$inferSelect | null {
    const row = tx
        .select({ entry: entries })
        .from(entries)
        .innerJoin(patientsToAmbulatories, eq(entries.patientId, patientsToAmbulatories.patientId))
        .where(and(
            eq(entries.id, context.entryId),
            eq(entries.patientId, context.patientId),
            eq(patientsToAmbulatories.ambulatoryId, context.scopeAmbulatoryId),
        ))
        .get();

    return row?.entry ?? null;
}

function isSameEntryCreatePayload(
    existing: typeof entries.$inferSelect,
    values: NormalizedNetworkEntryCreateValues
): boolean {
    return existing.type === values.type
        && existing.title === values.title
        && existing.date.getTime() === values.date.getTime()
        && existing.content === values.content
        && existing.setting === values.setting
        && existing.metadata === values.metadata
        && existing.attachments === values.attachments
        && existing.deletedAt === null;
}

function selectEntryConflictSnapshot(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    context: NetworkEntryUpdateContext
) {
    return tx
        .select({
            id: entries.id,
            patientId: entries.patientId,
            version: entries.version,
            updatedAt: entries.updatedAt,
            deletedAt: entries.deletedAt,
        })
        .from(entries)
        .where(and(eq(entries.id, context.entryId), eq(entries.patientId, context.patientId)))
        .get() ?? null;
}

async function writeNetworkEntryAuditEvent(input: {
    context: NetworkEntryMutationContext | NetworkEntryUpdateContext;
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
            subjectType: 'entry',
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
        console.error('[MediFlow] Network diary audit write failed:', error);
    }
}

/* @Codex */
export async function createNetworkScopedEntry(
    context: NetworkEntryMutationContext,
    body: Record<string, unknown>
): Promise<NetworkEntryMutationResponse> {
    const boundaryError = validateNetworkEntryMutationBoundary(body, NETWORK_FORBIDDEN_ENTRY_CREATE_FIELDS);
    if (boundaryError) return boundaryError;

    const newId = typeof body.id === 'string' && body.id.trim().length > 0 ? body.id : uuidv4();
    const normalized = normalizeEntryCreateInput(body, {
        id: newId,
        patientId: context.patientId,
    });
    if (!normalized.ok) {
        return { status: 400, value: { error: normalized.error } };
    }

    const commit = dbServer.transaction((tx): NetworkEntryMutationResponse => {
        if (!patientIsInScope(tx, context.patientId, context.scopeAmbulatoryId)) {
            return { status: 404, value: { error: 'Not found' } };
        }

        if (typeof body.id === 'string' && body.id.trim().length > 0) {
            const existing = tx
                .select()
                .from(entries)
                .where(and(eq(entries.id, newId), eq(entries.patientId, context.patientId)))
                .get();
            if (existing) {
                if (!isSameEntryCreatePayload(existing, normalized.values)) {
                    return {
                        status: 409,
                        value: {
                            error: 'Network diary create id already exists with different content',
                        },
                    };
                }

                return { status: 200, value: { id: existing.id, version: existing.version, idempotent: true } };
            }
        }

        tx.insert(entries).values(normalized.values).run();
        return { status: 201, value: { id: normalized.values.id, version: 1 } };
    });

    if (commit.status !== 201) return commit;

    await writeNetworkEntryAuditEvent({
        context,
        eventType: 'entry.created',
        subjectRef: commit.value.id,
        metadata: {
            changedFields: listChangedFields(body, ['id']),
            resourceVersion: 1,
        },
    });

    return commit;
}

/* @Codex */
export async function updateNetworkScopedEntry(
    context: NetworkEntryUpdateContext,
    body: Record<string, unknown>
): Promise<NetworkEntryMutationResponse> {
    const expectedVersion = parseEntryExpectedVersion(body.version);
    if (expectedVersion === null) {
        return { status: 400, value: { error: 'Version is required' } };
    }

    const boundaryError = validateNetworkEntryMutationBoundary(body, NETWORK_FORBIDDEN_ENTRY_UPDATE_FIELDS);
    if (boundaryError) return boundaryError;

    const normalized = normalizeEntryUpdateInput(body);
    if (!normalized.ok) {
        return { status: 400, value: { error: normalized.error } };
    }

    const commit = dbServer.transaction((tx): NetworkEntryMutationResponse => {
        const existing = entryIsInScope(tx, context);
        if (!existing) {
            return { status: 404, value: { error: 'Not found' } };
        }

        const updateResult = tx.update(entries)
            .set({
                ...normalized.values,
                version: expectedVersion + 1,
            })
            .where(and(
                eq(entries.id, context.entryId),
                eq(entries.patientId, context.patientId),
                eq(entries.version, expectedVersion),
            ))
            .run();

        if (updateResult.changes === 0) {
            return {
                status: 409,
                value: buildEntryVersionConflictPayload(
                    expectedVersion,
                    context.entryId,
                    selectEntryConflictSnapshot(tx, context),
                ),
            };
        }

        return { status: 200, value: { success: true } };
    });

    if (commit.status !== 200) return commit;

    await writeNetworkEntryAuditEvent({
        context,
        eventType: normalized.values.deletedAt ? 'entry.deleted' : 'entry.updated',
        subjectRef: context.entryId,
        metadata: {
            changedFields: listChangedFields(body, ['version']),
            resourceVersion: expectedVersion + 1,
        },
    });

    return commit;
}
