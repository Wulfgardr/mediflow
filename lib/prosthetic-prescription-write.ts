/* @Codex */
import { and, desc, eq } from 'drizzle-orm';
/* @Codex */
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import {
    prostheticPrescriptionCreateSchema,
    prostheticPrescriptionUpdateSchema,
    type ProstheticPrescriptionCreatePayload,
    type ProstheticPrescriptionUpdatePayload,
} from './api-schemas/prescriptions';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import type { NetworkWriteContext } from './network-write-context';
/* @Codex */
import { buildPrescriptionVersionConflictPayload, parsePrescriptionExpectedVersion } from './prescription-concurrency';
/* @Codex */
import {
    PROSTHETIC_PRESCRIPTION_CATEGORY_SET,
    PROSTHETIC_PRESCRIPTION_SOURCE_SET,
    PROSTHETIC_PRESCRIPTION_STATUS_SET,
    isAllowedPrescriptionValue,
    optionalPrescriptionText,
    optionalPrescriptionTextForUpdate,
    parseOptionalPrescriptionDate,
    parsePrescriptionDate,
} from './prescription-domain';
/* @Codex */
import { patientsToAmbulatories, prostheticPrescriptions } from './schema';
/* @Codex */
import {
    listChangedFields,
    requestIdFromRequest,
    safeWriteAuditEventFromRequest,
    writeAuditEvent,
    type AuditEventType,
    type AuditRedactedMetadata,
} from './security/audit';
/* @Codex */
import type { ServerSession } from './security/server-session';

/* @Codex */
export const NETWORK_PROSTHETIC_PRESCRIPTION_READ_CAPABILITY = 'network.replica.readonly-prosthetic-prescriptions';
/* @Codex */
export const NETWORK_PROSTHETIC_PRESCRIPTION_WRITE_CAPABILITY = 'network.replica.write-prosthetic-prescriptions';

type MutationResponse =
    | { status: 200; value: { success: true } }
    | { status: 201; value: { id: string; version: number } }
    | { status: 400 | 403 | 404 | 409; value: Record<string, unknown> };

type HostContext = {
    request: Request;
    session: ServerSession;
};

type NetworkPatientContext = NetworkWriteContext & {
    patientId: string;
};

type NetworkPrescriptionContext = NetworkWriteContext & {
    prescriptionId: string;
};

function hasOwn(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

function badRequest(error: string): MutationResponse {
    return { status: 400, value: { error } };
}

function patientIsInScope(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    patientId: string,
    scopeAmbulatoryId: string
): boolean {
    const row = tx.select({ patientId: patientsToAmbulatories.patientId })
        .from(patientsToAmbulatories)
        .where(and(eq(patientsToAmbulatories.patientId, patientId), eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId)))
        .get();
    return Boolean(row);
}

function normalizeCreate(
    body: ProstheticPrescriptionCreatePayload
): { ok: true; values: typeof prostheticPrescriptions.$inferInsert } | { ok: false; error: string } {
    const patientId = optionalPrescriptionText(body.patientId);
    const description = optionalPrescriptionText(body.description);
    const prescribedAt = parsePrescriptionDate(body.prescribedAt);
    const status = optionalPrescriptionText(body.status) ?? 'prescribed';
    const category = optionalPrescriptionText(body.category) ?? 'standard';
    const source = optionalPrescriptionText(body.source) ?? 'manual';

    if (!patientId || !description || !prescribedAt) return { ok: false, error: 'Missing required prosthetic prescription fields' };
    if (!isAllowedPrescriptionValue(PROSTHETIC_PRESCRIPTION_STATUS_SET, status) || !isAllowedPrescriptionValue(PROSTHETIC_PRESCRIPTION_CATEGORY_SET, category) || !isAllowedPrescriptionValue(PROSTHETIC_PRESCRIPTION_SOURCE_SET, source)) {
        return { ok: false, error: 'Unsupported prosthetic prescription status, category, or source' };
    }

    return {
        ok: true,
        values: {
            id: optionalPrescriptionText(body.id) ?? uuidv4(),
            patientId,
            prescribedAt,
            status,
            category,
            isoCode: optionalPrescriptionText(body.isoCode),
            description,
            measures: optionalPrescriptionText(body.measures),
            clinicalReason: optionalPrescriptionText(body.clinicalReason),
            regionalPrescriptionId: optionalPrescriptionText(body.regionalPrescriptionId),
            supplier: optionalPrescriptionText(body.supplier),
            collaudoAt: parsePrescriptionDate(body.collaudoAt),
            collaudoOutcome: optionalPrescriptionText(body.collaudoOutcome),
            source,
            documentRefs: optionalPrescriptionText(body.documentRefs),
            notes: optionalPrescriptionText(body.notes),
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    };
}

function normalizeUpdate(
    body: ProstheticPrescriptionUpdatePayload
): { ok: true; values: Partial<typeof prostheticPrescriptions.$inferInsert> } | { ok: false; error: string } {
    const updateData: Partial<typeof prostheticPrescriptions.$inferInsert> = { updatedAt: new Date() };
    const nullableTextFields = ['isoCode', 'measures', 'clinicalReason', 'regionalPrescriptionId', 'supplier', 'collaudoOutcome', 'documentRefs', 'notes'] as const;

    for (const field of nullableTextFields) {
        if (hasOwn(body, field)) updateData[field] = optionalPrescriptionTextForUpdate(body[field]) as never;
    }

    const prescribedAt = parseOptionalPrescriptionDate(body.prescribedAt);
    if (prescribedAt instanceof Date) updateData.prescribedAt = prescribedAt;
    const collaudoAt = parseOptionalPrescriptionDate(body.collaudoAt);
    if (collaudoAt instanceof Date || collaudoAt === null) updateData.collaudoAt = collaudoAt;

    const description = optionalPrescriptionTextForUpdate(body.description);
    if (hasOwn(body, 'description')) {
        if (!description) return { ok: false, error: 'Description cannot be empty' };
        updateData.description = description;
    }

    const status = optionalPrescriptionTextForUpdate(body.status);
    if (hasOwn(body, 'status')) {
        if (!isAllowedPrescriptionValue(PROSTHETIC_PRESCRIPTION_STATUS_SET, status)) return { ok: false, error: 'Unsupported prosthetic prescription status' };
        updateData.status = status;
    }

    const category = optionalPrescriptionTextForUpdate(body.category);
    if (hasOwn(body, 'category')) {
        if (!isAllowedPrescriptionValue(PROSTHETIC_PRESCRIPTION_CATEGORY_SET, category)) return { ok: false, error: 'Unsupported prosthetic prescription category' };
        updateData.category = category;
    }

    const source = optionalPrescriptionTextForUpdate(body.source);
    if (hasOwn(body, 'source')) {
        if (!isAllowedPrescriptionValue(PROSTHETIC_PRESCRIPTION_SOURCE_SET, source)) return { ok: false, error: 'Unsupported prosthetic prescription source' };
        updateData.source = source;
    }

    return { ok: true, values: updateData };
}

function selectConflictSnapshot(tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0], id: string) {
    return tx.select({
        id: prostheticPrescriptions.id,
        patientId: prostheticPrescriptions.patientId,
        version: prostheticPrescriptions.version,
        updatedAt: prostheticPrescriptions.updatedAt,
    }).from(prostheticPrescriptions).where(eq(prostheticPrescriptions.id, id)).get() ?? null;
}

async function writeNetworkProstheticAuditEvent(input: {
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
            subjectType: 'prosthetic_prescription',
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
        console.error('[MediFlow] Network prosthetic prescription audit write failed:', error);
    }
}

/* @Codex */
export async function listProstheticPrescriptions(patientId: string | null) {
    let query = dbServer.select().from(prostheticPrescriptions);
    if (patientId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query = query.where(eq(prostheticPrescriptions.patientId, patientId)) as any;
    }
    return query.orderBy(desc(prostheticPrescriptions.prescribedAt));
}

/* @Codex */
export async function listNetworkScopedProstheticPrescriptions(patientId: string, scopeAmbulatoryId: string) {
    const rows = await dbServer.select({ item: prostheticPrescriptions })
        .from(prostheticPrescriptions)
        .innerJoin(patientsToAmbulatories, eq(prostheticPrescriptions.patientId, patientsToAmbulatories.patientId))
        .where(and(eq(prostheticPrescriptions.patientId, patientId), eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId)))
        .orderBy(desc(prostheticPrescriptions.prescribedAt));
    return rows.map((row) => row.item);
}

/* @Codex */
export async function createHostProstheticPrescription(context: HostContext, rawBody: Record<string, unknown>): Promise<MutationResponse> {
    const parsed = prostheticPrescriptionCreateSchema.safeParse(rawBody);
    if (!parsed.success) return badRequest('Payload non valido');
    const normalized = normalizeCreate(parsed.data);
    if (!normalized.ok) return badRequest(normalized.error);

    await dbServer.insert(prostheticPrescriptions).values(normalized.values);
    await safeWriteAuditEventFromRequest(context.request, context.session, {
        eventType: 'prosthetic.prescription.created',
        subjectType: 'prosthetic_prescription',
        subjectRef: normalized.values.id,
        redactedMetadata: {
            changedFields: listChangedFields(rawBody, ['id']),
            flags: [`source:${normalized.values.source}`, `status:${normalized.values.status}`, `category:${normalized.values.category}`],
            resourceVersion: 1,
        },
    }, '[MediFlow] Prosthetic prescription audit write failed:');
    return { status: 201, value: { id: normalized.values.id, version: 1 } };
}

/* @Codex */
export async function updateHostProstheticPrescription(context: HostContext & { id: string }, rawBody: Record<string, unknown>): Promise<MutationResponse> {
    const parsed = prostheticPrescriptionUpdateSchema.safeParse(rawBody);
    if (!parsed.success) return badRequest('Payload non valido');
    return updateProstheticPrescription(context, parsed.data, 'host');
}

async function updateProstheticPrescription(
    context: (HostContext | NetworkWriteContext) & { id: string },
    body: ProstheticPrescriptionUpdatePayload,
    surface: 'host' | 'network'
): Promise<MutationResponse> {
    const expectedVersion = parsePrescriptionExpectedVersion(body.version);
    if (expectedVersion === null) return badRequest('Version is required');
    const normalized = normalizeUpdate(body);
    if (!normalized.ok) return badRequest(normalized.error);

    const commit = dbServer.transaction((tx): MutationResponse => {
        const existing = tx.select({ item: prostheticPrescriptions }).from(prostheticPrescriptions).where(eq(prostheticPrescriptions.id, context.id)).get();
        if (!existing) return { status: 404, value: { error: surface === 'host' ? 'Prosthetic prescription not found' : 'Not found' } };

        const updateResult = tx.update(prostheticPrescriptions)
            .set({ ...normalized.values, version: expectedVersion + 1 })
            .where(and(eq(prostheticPrescriptions.id, context.id), eq(prostheticPrescriptions.version, expectedVersion)))
            .run();
        if (updateResult.changes === 0) {
            return {
                status: 409,
                value: buildPrescriptionVersionConflictPayload(
                    'prosthetic_prescription',
                    expectedVersion,
                    context.id,
                    selectConflictSnapshot(tx, context.id),
                ),
            };
        }
        return { status: 200, value: { success: true } };
    });

    if (commit.status !== 200) return commit;

    if (surface === 'host') {
        await safeWriteAuditEventFromRequest(context.request, (context as HostContext).session, {
            eventType: 'prosthetic.prescription.updated',
            subjectType: 'prosthetic_prescription',
            subjectRef: context.id,
            redactedMetadata: {
                changedFields: listChangedFields(body as Record<string, unknown>, ['version']),
                resourceVersion: expectedVersion + 1,
            },
        }, '[MediFlow] Prosthetic prescription audit write failed:');
    } else {
        await writeNetworkProstheticAuditEvent({
            context: context as NetworkWriteContext,
            eventType: 'prosthetic.prescription.updated',
            subjectRef: context.id,
            metadata: {
                changedFields: listChangedFields(body as Record<string, unknown>, ['version']),
                resourceVersion: expectedVersion + 1,
            },
        });
    }

    return commit;
}

/* @Codex */
export async function deleteHostProstheticPrescription(context: HostContext & { id: string }, expectedVersion: number): Promise<MutationResponse> {
    const commit = dbServer.transaction((tx): MutationResponse => {
        const existing = selectConflictSnapshot(tx, context.id);
        if (!existing) return { status: 404, value: { error: 'Prosthetic prescription not found' } };

        const deleteResult = tx.delete(prostheticPrescriptions)
            .where(and(eq(prostheticPrescriptions.id, context.id), eq(prostheticPrescriptions.version, expectedVersion)))
            .run();
        if (deleteResult.changes === 0) {
            return {
                status: 409,
                value: buildPrescriptionVersionConflictPayload('prosthetic_prescription', expectedVersion, context.id, existing),
            };
        }
        return { status: 200, value: { success: true } };
    });
    if (commit.status !== 200) return commit;

    await safeWriteAuditEventFromRequest(context.request, context.session, {
        eventType: 'prosthetic.prescription.deleted',
        subjectType: 'prosthetic_prescription',
        subjectRef: context.id,
        redactedMetadata: { resourceVersion: expectedVersion },
    }, '[MediFlow] Prosthetic prescription audit write failed:');
    return commit;
}

/* @Codex */
export async function createNetworkScopedProstheticPrescription(context: NetworkPatientContext, rawBody: Record<string, unknown>): Promise<MutationResponse> {
    const parsed = prostheticPrescriptionCreateSchema.safeParse({ ...rawBody, patientId: context.patientId });
    if (!parsed.success) return badRequest('Payload non valido');
    const normalized = normalizeCreate(parsed.data);
    if (!normalized.ok) return badRequest(normalized.error);

    const commit = dbServer.transaction((tx): MutationResponse => {
        if (!patientIsInScope(tx, context.patientId, context.scopeAmbulatoryId)) return { status: 404, value: { error: 'Not found' } };
        tx.insert(prostheticPrescriptions).values(normalized.values).run();
        return { status: 201, value: { id: normalized.values.id, version: 1 } };
    });
    if (commit.status !== 201) return commit;
    await writeNetworkProstheticAuditEvent({
        context,
        eventType: 'prosthetic.prescription.created',
        subjectRef: commit.value.id,
        metadata: { changedFields: listChangedFields(rawBody, ['id']), resourceVersion: 1 },
    });
    return commit;
}

/* @Codex */
export async function updateNetworkScopedProstheticPrescription(context: NetworkPrescriptionContext, rawBody: Record<string, unknown>): Promise<MutationResponse> {
    const parsed = prostheticPrescriptionUpdateSchema.safeParse(rawBody);
    if (!parsed.success) return badRequest('Payload non valido');
    const scoped = await dbServer.select({ id: prostheticPrescriptions.id })
        .from(prostheticPrescriptions)
        .innerJoin(patientsToAmbulatories, eq(prostheticPrescriptions.patientId, patientsToAmbulatories.patientId))
        .where(and(eq(prostheticPrescriptions.id, context.prescriptionId), eq(patientsToAmbulatories.ambulatoryId, context.scopeAmbulatoryId)))
        .get();
    if (!scoped) return { status: 404, value: { error: 'Not found' } };
    return updateProstheticPrescription({ ...context, id: context.prescriptionId }, parsed.data, 'network');
}
