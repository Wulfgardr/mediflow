/* @Codex */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
/* @Codex */
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import {
    servicePrescriptionCreateSchema,
    servicePrescriptionItemCreateSchema,
    servicePrescriptionItemUpdateSchema,
    servicePrescriptionUpdateSchema,
    type ServicePrescriptionCreatePayload,
    type ServicePrescriptionItemCreatePayload,
    type ServicePrescriptionItemUpdatePayload,
    type ServicePrescriptionUpdatePayload,
} from './api-schemas/prescriptions';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import { activePatients } from './patient-lifecycle';
/* @Codex */
import type { NetworkWriteContext } from './network-write-context';
/* @Codex */
import { buildPrescriptionVersionConflictPayload, parsePrescriptionExpectedVersion } from './prescription-concurrency';
/* @Codex */
import {
    SERVICE_PRESCRIPTION_CATEGORY_SET,
    SERVICE_PRESCRIPTION_ITEM_CONFIDENCE_SET,
    SERVICE_PRESCRIPTION_ITEM_MATCH_STATUS_SET,
    SERVICE_PRESCRIPTION_PRIORITY_SET,
    SERVICE_PRESCRIPTION_SOURCE_SET,
    SERVICE_PRESCRIPTION_STATUS_SET,
    isAllowedPrescriptionValue,
    optionalPrescriptionInteger,
    optionalPrescriptionIntegerForUpdate,
    optionalPrescriptionText,
    optionalPrescriptionTextForUpdate,
    parseOptionalPrescriptionDate,
    parsePrescriptionDate,
} from './prescription-domain';
/* @Codex */
import { patients, patientsToAmbulatories, serviceCatalogEntries, servicePrescriptionItems, servicePrescriptions } from './schema';
/* @Codex */
import {
    listChangedFields,
    requestIdFromRequest,
    auditContextFromSession,
    withAuditContextMetadata,
    writeAuditEventInTransaction,
    type AuditEventType,
    type AuditRedactedMetadata,
} from './security/audit';
/* @Codex */
import type { ServerSession } from './security/server-session';

/* @Codex */
export const NETWORK_SERVICE_PRESCRIPTION_READ_CAPABILITY = 'network.replica.readonly-service-prescriptions';
/* @Codex */
export const NETWORK_SERVICE_PRESCRIPTION_WRITE_CAPABILITY = 'network.replica.write-service-prescriptions';

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

type NetworkItemContext = NetworkWriteContext & {
    itemId: string;
};

function badRequest(error: string): MutationResponse {
    return { status: 400, value: { error } };
}

function hasOwn(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

/* @Codex: patient admission is checked on the same transaction as the write. */
function activeParentExists(tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0], patientId: string): boolean {
    return Boolean(tx.select({ id: patients.id }).from(patients)
        .where(and(eq(patients.id, patientId), activePatients())).get());
}

function patientIsInScope(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    patientId: string,
    scopeAmbulatoryId: string
): boolean {
    const row = tx.select({ patientId: patientsToAmbulatories.patientId })
        .from(patientsToAmbulatories)
        .where(and(
            eq(patientsToAmbulatories.patientId, patientId),
            eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
        ))
        .get();
    return Boolean(row);
}

function normalizeServicePrescriptionCreate(
    body: ServicePrescriptionCreatePayload
): { ok: true; values: typeof servicePrescriptions.$inferInsert } | { ok: false; error: string } {
    const patientId = optionalPrescriptionText(body.patientId);
    const serviceName = optionalPrescriptionText(body.serviceName);
    const prescribedAt = parsePrescriptionDate(body.prescribedAt);
    const status = optionalPrescriptionText(body.status) ?? 'prescribed';
    const category = optionalPrescriptionText(body.category) ?? 'other';
    const priority = optionalPrescriptionText(body.priority);
    const source = optionalPrescriptionText(body.source) ?? 'manual';

    if (!patientId || !serviceName || !prescribedAt) return { ok: false, error: 'Missing required service prescription fields' };
    if (!isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_STATUS_SET, status) || !isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_CATEGORY_SET, category) || !isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_SOURCE_SET, source)) {
        return { ok: false, error: 'Unsupported service prescription status, category, or source' };
    }
    if (priority && !isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_PRIORITY_SET, priority)) {
        return { ok: false, error: 'Unsupported service prescription priority' };
    }

    return {
        ok: true,
        values: {
            id: optionalPrescriptionText(body.id) ?? uuidv4(),
            patientId,
            prescribedAt,
            status,
            category,
            priority,
            codeSystem: optionalPrescriptionText(body.codeSystem),
            serviceCode: optionalPrescriptionText(body.serviceCode),
            serviceName,
            clinicalQuestion: optionalPrescriptionText(body.clinicalQuestion),
            provider: optionalPrescriptionText(body.provider),
            scheduledAt: parsePrescriptionDate(body.scheduledAt),
            performedAt: parsePrescriptionDate(body.performedAt),
            reportReceivedAt: parsePrescriptionDate(body.reportReceivedAt),
            outcomeNote: optionalPrescriptionText(body.outcomeNote),
            requestReference: optionalPrescriptionText(body.requestReference),
            source,
            documentRefs: optionalPrescriptionText(body.documentRefs),
            notes: optionalPrescriptionText(body.notes),
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    };
}

function normalizeServicePrescriptionUpdate(
    body: ServicePrescriptionUpdatePayload
): { ok: true; values: Partial<typeof servicePrescriptions.$inferInsert> } | { ok: false; error: string } {
    const updateData: Partial<typeof servicePrescriptions.$inferInsert> = { updatedAt: new Date() };
    const nullableTextFields = [
        'priority',
        'codeSystem',
        'serviceCode',
        'clinicalQuestion',
        'provider',
        'outcomeNote',
        'requestReference',
        'documentRefs',
        'notes',
    ] as const;

    for (const field of nullableTextFields) {
        if (hasOwn(body, field)) updateData[field] = optionalPrescriptionTextForUpdate(body[field]) as never;
    }

    const prescribedAt = parseOptionalPrescriptionDate(body.prescribedAt);
    if (prescribedAt instanceof Date) updateData.prescribedAt = prescribedAt;
    const scheduledAt = parseOptionalPrescriptionDate(body.scheduledAt);
    if (scheduledAt instanceof Date || scheduledAt === null) updateData.scheduledAt = scheduledAt;
    const performedAt = parseOptionalPrescriptionDate(body.performedAt);
    if (performedAt instanceof Date || performedAt === null) updateData.performedAt = performedAt;
    const reportReceivedAt = parseOptionalPrescriptionDate(body.reportReceivedAt);
    if (reportReceivedAt instanceof Date || reportReceivedAt === null) updateData.reportReceivedAt = reportReceivedAt;

    const serviceName = optionalPrescriptionTextForUpdate(body.serviceName);
    if (hasOwn(body, 'serviceName')) {
        if (!serviceName) return { ok: false, error: 'Service name cannot be empty' };
        updateData.serviceName = serviceName;
    }

    const status = optionalPrescriptionTextForUpdate(body.status);
    if (hasOwn(body, 'status')) {
        if (!isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_STATUS_SET, status)) return { ok: false, error: 'Unsupported service prescription status' };
        updateData.status = status;
    }

    const category = optionalPrescriptionTextForUpdate(body.category);
    if (hasOwn(body, 'category')) {
        if (!isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_CATEGORY_SET, category)) return { ok: false, error: 'Unsupported service prescription category' };
        updateData.category = category;
    }

    const priority = optionalPrescriptionTextForUpdate(body.priority);
    if (hasOwn(body, 'priority')) {
        if (priority && !isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_PRIORITY_SET, priority)) return { ok: false, error: 'Unsupported service prescription priority' };
        updateData.priority = priority;
    }

    const source = optionalPrescriptionTextForUpdate(body.source);
    if (hasOwn(body, 'source')) {
        if (!isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_SOURCE_SET, source)) return { ok: false, error: 'Unsupported service prescription source' };
        updateData.source = source;
    }

    return { ok: true, values: updateData };
}

function normalizeServicePrescriptionItemCreate(
    body: ServicePrescriptionItemCreatePayload,
    parent: { patientId: string }
): { ok: true; values: typeof servicePrescriptionItems.$inferInsert } | { ok: false; error: string } {
    const prescriptionId = optionalPrescriptionText(body.prescriptionId);
    const serviceName = optionalPrescriptionText(body.serviceName);
    const status = optionalPrescriptionText(body.status) ?? 'prescribed';
    const category = optionalPrescriptionText(body.category);
    const matchStatus = optionalPrescriptionText(body.matchStatus) ?? 'unmatched';
    const confidence = optionalPrescriptionText(body.confidence);

    if (!prescriptionId || !serviceName) return { ok: false, error: 'Missing required service prescription item fields' };
    if (!isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_STATUS_SET, status) || !isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_ITEM_MATCH_STATUS_SET, matchStatus)) {
        return { ok: false, error: 'Unsupported service item status or match status' };
    }
    if (category && !isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_CATEGORY_SET, category)) return { ok: false, error: 'Unsupported service item category' };
    if (confidence && !isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_ITEM_CONFIDENCE_SET, confidence)) return { ok: false, error: 'Unsupported service item confidence' };

    return {
        ok: true,
        values: {
            id: optionalPrescriptionText(body.id) ?? uuidv4(),
            patientId: parent.patientId,
            prescriptionId,
            ordinal: optionalPrescriptionInteger(body.ordinal),
            status,
            category,
            codeSystem: optionalPrescriptionText(body.codeSystem),
            serviceCode: optionalPrescriptionText(body.serviceCode),
            serviceName,
            catalogEntryId: optionalPrescriptionText(body.catalogEntryId),
            catalogDisplayName: optionalPrescriptionText(body.catalogDisplayName),
            matchStatus,
            confidence,
            evidence: optionalPrescriptionText(body.evidence),
            notes: optionalPrescriptionText(body.notes),
            scheduledAt: parsePrescriptionDate(body.scheduledAt),
            performedAt: parsePrescriptionDate(body.performedAt),
            reportReceivedAt: parsePrescriptionDate(body.reportReceivedAt),
            outcomeNote: optionalPrescriptionText(body.outcomeNote),
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    };
}

function normalizeServicePrescriptionItemUpdate(
    body: ServicePrescriptionItemUpdatePayload
): { ok: true; values: Partial<typeof servicePrescriptionItems.$inferInsert> } | { ok: false; error: string } {
    const updateData: Partial<typeof servicePrescriptionItems.$inferInsert> = { updatedAt: new Date() };
    const nullableTextFields = ['codeSystem', 'serviceCode', 'catalogEntryId', 'catalogDisplayName', 'evidence', 'notes', 'outcomeNote'] as const;
    for (const field of nullableTextFields) {
        if (hasOwn(body, field)) updateData[field] = optionalPrescriptionTextForUpdate(body[field]) as never;
    }

    const ordinal = optionalPrescriptionIntegerForUpdate(body.ordinal);
    if (ordinal !== undefined) updateData.ordinal = ordinal;

    const serviceName = optionalPrescriptionTextForUpdate(body.serviceName);
    if (hasOwn(body, 'serviceName')) {
        if (!serviceName) return { ok: false, error: 'Service item name cannot be empty' };
        updateData.serviceName = serviceName;
    }

    const status = optionalPrescriptionTextForUpdate(body.status);
    if (hasOwn(body, 'status')) {
        if (!isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_STATUS_SET, status)) return { ok: false, error: 'Unsupported service item status' };
        updateData.status = status;
    }

    const category = optionalPrescriptionTextForUpdate(body.category);
    if (hasOwn(body, 'category')) {
        if (category && !isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_CATEGORY_SET, category)) return { ok: false, error: 'Unsupported service item category' };
        updateData.category = category;
    }

    const matchStatus = optionalPrescriptionTextForUpdate(body.matchStatus);
    if (hasOwn(body, 'matchStatus')) {
        if (!isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_ITEM_MATCH_STATUS_SET, matchStatus)) return { ok: false, error: 'Unsupported service item match status' };
        updateData.matchStatus = matchStatus;
    }

    const confidence = optionalPrescriptionTextForUpdate(body.confidence);
    if (hasOwn(body, 'confidence')) {
        if (confidence && !isAllowedPrescriptionValue(SERVICE_PRESCRIPTION_ITEM_CONFIDENCE_SET, confidence)) return { ok: false, error: 'Unsupported service item confidence' };
        updateData.confidence = confidence;
    }

    const scheduledAt = parseOptionalPrescriptionDate(body.scheduledAt);
    if (scheduledAt instanceof Date || scheduledAt === null) updateData.scheduledAt = scheduledAt;
    const performedAt = parseOptionalPrescriptionDate(body.performedAt);
    if (performedAt instanceof Date || performedAt === null) updateData.performedAt = performedAt;
    const reportReceivedAt = parseOptionalPrescriptionDate(body.reportReceivedAt);
    if (reportReceivedAt instanceof Date || reportReceivedAt === null) updateData.reportReceivedAt = reportReceivedAt;

    return { ok: true, values: updateData };
}

function selectServicePrescriptionConflictSnapshot(tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0], id: string) {
    return tx.select({
        id: servicePrescriptions.id,
        patientId: servicePrescriptions.patientId,
        version: servicePrescriptions.version,
        updatedAt: servicePrescriptions.updatedAt,
    }).from(servicePrescriptions).where(eq(servicePrescriptions.id, id)).get() ?? null;
}

function selectServicePrescriptionItemConflictSnapshot(tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0], id: string) {
    return tx.select({
        id: servicePrescriptionItems.id,
        patientId: servicePrescriptionItems.patientId,
        version: servicePrescriptionItems.version,
        updatedAt: servicePrescriptionItems.updatedAt,
    }).from(servicePrescriptionItems).where(eq(servicePrescriptionItems.id, id)).get() ?? null;
}

/* @Codex: audit actor and surface come from the admitted context. */
function serviceAuditInput(
    context: HostContext | NetworkWriteContext,
    surface: 'host' | 'network',
    eventType: AuditEventType,
    subjectType: 'service_prescription' | 'service_prescription_item',
    subjectRef: string,
    metadata?: AuditRedactedMetadata | null,
) {
    const actor = auditContextFromSession(context.session);
    const flags = surface === 'network'
        ? [...(metadata?.flags ?? []), 'auth:paired-client', `paired-client:${(context as NetworkWriteContext).pairedClient.clientId}`, 'scope:ambulatory']
        : metadata?.flags;
    return {
        eventType, outcome: 'success' as const,
        actorType: surface === 'network' ? 'user' as const : actor.actorType,
        actorRef: surface === 'network' ? context.session.userId : actor.actorRef,
        subjectType, subjectRef,
        sourceSurface: surface === 'network' ? 'native' as const : actor.sourceSurface,
        requestId: requestIdFromRequest(context.request),
        redactedMetadata: surface === 'network'
            ? { ...(metadata ?? {}), flags }
            : withAuditContextMetadata(actor, metadata),
    };
}

/* @Codex */
export async function listServicePrescriptions(patientId: string | null) {
    let query = dbServer.select().from(servicePrescriptions);
    if (patientId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query = query.where(eq(servicePrescriptions.patientId, patientId)) as any;
    }
    return query.orderBy(desc(servicePrescriptions.prescribedAt));
}

/* @Codex */
export async function listServicePrescriptionItems(input: { patientId?: string | null; prescriptionId?: string | null }) {
    let query = dbServer.select().from(servicePrescriptionItems);
    if (input.prescriptionId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query = query.where(eq(servicePrescriptionItems.prescriptionId, input.prescriptionId)) as any;
    } else if (input.patientId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query = query.where(eq(servicePrescriptionItems.patientId, input.patientId)) as any;
    }
    return query.orderBy(asc(servicePrescriptionItems.prescriptionId), asc(servicePrescriptionItems.ordinal));
}

/* @Codex */
export async function listNetworkScopedServicePrescriptions(patientId: string, scopeAmbulatoryId: string) {
    const rows = await dbServer.select({ item: servicePrescriptions })
        .from(servicePrescriptions)
        .innerJoin(patientsToAmbulatories, eq(servicePrescriptions.patientId, patientsToAmbulatories.patientId))
        .where(and(eq(servicePrescriptions.patientId, patientId), eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId)))
        .orderBy(desc(servicePrescriptions.prescribedAt));
    return rows.map((row) => row.item);
}

/* @Codex */
export async function listNetworkScopedServicePrescriptionItems(input: {
    patientId?: string | null;
    prescriptionId?: string | null;
    scopeAmbulatoryId: string;
}): Promise<Array<typeof servicePrescriptionItems.$inferSelect> | { status: 400 | 404; value: Record<string, unknown> }> {
    if (!input.patientId && !input.prescriptionId) return { status: 400, value: { error: 'patientId or prescriptionId is required' } };

    if (input.prescriptionId) {
        const parent = await dbServer.select({ id: servicePrescriptions.id, patientId: servicePrescriptions.patientId })
            .from(servicePrescriptions)
            .innerJoin(patientsToAmbulatories, eq(servicePrescriptions.patientId, patientsToAmbulatories.patientId))
            .where(and(eq(servicePrescriptions.id, input.prescriptionId), eq(patientsToAmbulatories.ambulatoryId, input.scopeAmbulatoryId)))
            .get();
        if (!parent) return { status: 404, value: { error: 'Not found' } };
        return listServicePrescriptionItems({ prescriptionId: input.prescriptionId });
    }

    const scoped = await dbServer.select({ patientId: patientsToAmbulatories.patientId })
        .from(patientsToAmbulatories)
        .where(and(eq(patientsToAmbulatories.patientId, input.patientId ?? ''), eq(patientsToAmbulatories.ambulatoryId, input.scopeAmbulatoryId)))
        .get();
    if (!scoped) return { status: 404, value: { error: 'Not found' } };
    return listServicePrescriptionItems({ patientId: input.patientId });
}

/* @Codex */
export async function createHostServicePrescription(context: HostContext, rawBody: Record<string, unknown>): Promise<MutationResponse> {
    const parsed = servicePrescriptionCreateSchema.safeParse(rawBody);
    if (!parsed.success) return badRequest('Payload non valido');
    const normalized = normalizeServicePrescriptionCreate(parsed.data);
    if (!normalized.ok) return badRequest(normalized.error);
    return dbServer.transaction((tx): MutationResponse => {
        if (!activeParentExists(tx, normalized.values.patientId)) return { status: 404, value: { error: 'Not found' } };
        const inserted = tx.insert(servicePrescriptions).values(normalized.values).run();
        if (inserted.changes !== 1) throw new Error('Service prescription create did not write exactly one row');
        writeAuditEventInTransaction(tx, serviceAuditInput(context, 'host', 'service.prescription.created', 'service_prescription', normalized.values.id, {
            changedFields: listChangedFields(rawBody, ['id']),
            flags: [`source:${normalized.values.source}`, `status:${normalized.values.status}`, `category:${normalized.values.category}`],
            resourceVersion: 1,
        }));
        return { status: 201, value: { id: normalized.values.id, version: 1 } };
    }, { behavior: 'immediate' });
}

/* @Codex */
export async function updateHostServicePrescription(context: HostContext & { id: string }, rawBody: Record<string, unknown>): Promise<MutationResponse> {
    const parsed = servicePrescriptionUpdateSchema.safeParse(rawBody);
    if (!parsed.success) return badRequest('Payload non valido');
    return updateServicePrescription(context, parsed.data, 'host');
}

async function updateServicePrescription(
    context: (HostContext | NetworkWriteContext) & { id: string },
    body: ServicePrescriptionUpdatePayload,
    surface: 'host' | 'network'
): Promise<MutationResponse> {
    const expectedVersion = parsePrescriptionExpectedVersion(body.version);
    if (expectedVersion === null) return badRequest('Version is required');
    const normalized = normalizeServicePrescriptionUpdate(body);
    if (!normalized.ok) return badRequest(normalized.error);
    return dbServer.transaction((tx): MutationResponse => {
        const existing = tx.select().from(servicePrescriptions).where(eq(servicePrescriptions.id, context.id)).get();
        if (!existing) return { status: 404, value: { error: surface === 'host' ? 'Service prescription not found' : 'Not found' } };
        if (!activeParentExists(tx, existing.patientId) || (surface === 'network' && !patientIsInScope(tx, existing.patientId, (context as NetworkWriteContext).scopeAmbulatoryId))) return { status: 404, value: { error: 'Not found' } };
        if (existing.version !== expectedVersion) return { status: 409, value: buildPrescriptionVersionConflictPayload('service_prescription', expectedVersion, context.id, selectServicePrescriptionConflictSnapshot(tx, context.id)) };
        const updated = tx.update(servicePrescriptions).set({ ...normalized.values, version: expectedVersion + 1 })
            .where(and(eq(servicePrescriptions.id, context.id), eq(servicePrescriptions.version, expectedVersion))).run();
        if (updated.changes !== 1) throw new Error('Service prescription update did not write exactly one row');
        writeAuditEventInTransaction(tx, serviceAuditInput(context, surface, 'service.prescription.updated', 'service_prescription', context.id, {
            changedFields: listChangedFields(body as Record<string, unknown>, ['version']), resourceVersion: expectedVersion + 1,
        }));
        return { status: 200, value: { success: true } };
    }, { behavior: 'immediate' });
}

/* @Codex */
export async function deleteHostServicePrescription(context: HostContext & { id: string }, expectedVersion: number): Promise<MutationResponse> {
    return dbServer.transaction((tx): MutationResponse => {
        const existing = selectServicePrescriptionConflictSnapshot(tx, context.id);
        if (!existing) return { status: 404, value: { error: 'Service prescription not found' } };
        if (!activeParentExists(tx, existing.patientId)) return { status: 404, value: { error: 'Not found' } };
        if (existing.version !== expectedVersion) return { status: 409, value: buildPrescriptionVersionConflictPayload('service_prescription', expectedVersion, context.id, existing) };
        // @Codex: the aggregate version guards its hard-delete cascade.
        const childCount = tx.select({ count: sql<number>`count(*)` }).from(servicePrescriptionItems)
            .where(eq(servicePrescriptionItems.prescriptionId, context.id)).get()?.count ?? 0;
        const children = tx.delete(servicePrescriptionItems).where(eq(servicePrescriptionItems.prescriptionId, context.id)).run();
        if (children.changes !== childCount) throw new Error('Service prescription cascade did not remove every item');
        const deleted = tx.delete(servicePrescriptions).where(and(eq(servicePrescriptions.id, context.id), eq(servicePrescriptions.version, expectedVersion))).run();
        if (deleted.changes !== 1) throw new Error('Service prescription delete did not remove exactly one row');
        writeAuditEventInTransaction(tx, serviceAuditInput(context, 'host', 'service.prescription.deleted', 'service_prescription', context.id,
            { resourceVersion: expectedVersion }));
        return { status: 200, value: { success: true } };
    }, { behavior: 'immediate' });
}

/* @Codex */
export async function createHostServicePrescriptionItem(context: HostContext, rawBody: Record<string, unknown>): Promise<MutationResponse> {
    const parsed = servicePrescriptionItemCreateSchema.safeParse(rawBody);
    if (!parsed.success) return badRequest('Payload non valido');
    return createServicePrescriptionItem(context, parsed.data, 'host');
}

async function createServicePrescriptionItem(context: HostContext | NetworkWriteContext, body: ServicePrescriptionItemCreatePayload, surface: 'host' | 'network'): Promise<MutationResponse> {
    const prescriptionId = optionalPrescriptionText(body.prescriptionId);
    if (!prescriptionId) return badRequest('Missing required service prescription item fields');
    return dbServer.transaction((tx): MutationResponse => {
        const parent = tx.select({ id: servicePrescriptions.id, patientId: servicePrescriptions.patientId }).from(servicePrescriptions).where(eq(servicePrescriptions.id, prescriptionId)).get();
        if (!parent) return { status: 404, value: { error: surface === 'host' ? 'Service prescription not found' : 'Not found' } };
        if (!activeParentExists(tx, parent.patientId) || (surface === 'network' && !patientIsInScope(tx, parent.patientId, (context as NetworkWriteContext).scopeAmbulatoryId))) return { status: 404, value: { error: 'Not found' } };
        const normalized = normalizeServicePrescriptionItemCreate(body, parent);
        if (!normalized.ok) return badRequest(normalized.error);
        const inserted = tx.insert(servicePrescriptionItems).values(normalized.values).run();
        if (inserted.changes !== 1) throw new Error('Service prescription item create did not write exactly one row');
        writeAuditEventInTransaction(tx, serviceAuditInput(context, surface, 'service.prescription_item.created', 'service_prescription_item', normalized.values.id, {
            changedFields: listChangedFields(body as Record<string, unknown>, ['id']), resourceVersion: 1,
        }));
        return { status: 201, value: { id: normalized.values.id, version: 1 } };
    }, { behavior: 'immediate' });
}

/* @Codex */
export async function updateHostServicePrescriptionItem(context: HostContext & { id: string }, rawBody: Record<string, unknown>): Promise<MutationResponse> {
    const parsed = servicePrescriptionItemUpdateSchema.safeParse(rawBody);
    if (!parsed.success) return badRequest('Payload non valido');
    return updateServicePrescriptionItem(context, parsed.data, 'host');
}

async function updateServicePrescriptionItem(context: (HostContext | NetworkWriteContext) & { id: string }, body: ServicePrescriptionItemUpdatePayload, surface: 'host' | 'network'): Promise<MutationResponse> {
    const expectedVersion = parsePrescriptionExpectedVersion(body.version);
    if (expectedVersion === null) return badRequest('Version is required');
    const normalized = normalizeServicePrescriptionItemUpdate(body);
    if (!normalized.ok) return badRequest(normalized.error);
    return dbServer.transaction((tx): MutationResponse => {
        const existing = tx.select().from(servicePrescriptionItems).where(eq(servicePrescriptionItems.id, context.id)).get();
        if (!existing) return { status: 404, value: { error: surface === 'host' ? 'Service prescription item not found' : 'Not found' } };
        const parent = tx.select({ patientId: servicePrescriptions.patientId }).from(servicePrescriptions).where(eq(servicePrescriptions.id, existing.prescriptionId)).get();
        if (!parent || parent.patientId !== existing.patientId || !activeParentExists(tx, existing.patientId) || (surface === 'network' && !patientIsInScope(tx, existing.patientId, (context as NetworkWriteContext).scopeAmbulatoryId))) return { status: 404, value: { error: 'Not found' } };
        if (existing.version !== expectedVersion) return { status: 409, value: buildPrescriptionVersionConflictPayload('service_prescription_item', expectedVersion, context.id, selectServicePrescriptionItemConflictSnapshot(tx, context.id)) };
        const updated = tx.update(servicePrescriptionItems).set({ ...normalized.values, version: expectedVersion + 1 })
            .where(and(eq(servicePrescriptionItems.id, context.id), eq(servicePrescriptionItems.version, expectedVersion))).run();
        if (updated.changes !== 1) throw new Error('Service prescription item update did not write exactly one row');
        writeAuditEventInTransaction(tx, serviceAuditInput(context, surface, 'service.prescription_item.updated', 'service_prescription_item', context.id, {
            changedFields: listChangedFields(body as Record<string, unknown>, ['version']), resourceVersion: expectedVersion + 1,
        }));
        return { status: 200, value: { success: true } };
    }, { behavior: 'immediate' });
}

/* @Codex */
export async function deleteHostServicePrescriptionItem(context: HostContext & { id: string }, expectedVersion: number): Promise<MutationResponse> {
    return dbServer.transaction((tx): MutationResponse => {
        const existing = tx.select().from(servicePrescriptionItems).where(eq(servicePrescriptionItems.id, context.id)).get();
        if (!existing) return { status: 404, value: { error: 'Service prescription item not found' } };
        const parent = tx.select({ patientId: servicePrescriptions.patientId }).from(servicePrescriptions).where(eq(servicePrescriptions.id, existing.prescriptionId)).get();
        if (!parent || parent.patientId !== existing.patientId || !activeParentExists(tx, existing.patientId)) return { status: 404, value: { error: 'Not found' } };
        if (existing.version !== expectedVersion) return { status: 409, value: buildPrescriptionVersionConflictPayload('service_prescription_item', expectedVersion, context.id, selectServicePrescriptionItemConflictSnapshot(tx, context.id)) };
        const deleted = tx.delete(servicePrescriptionItems).where(and(eq(servicePrescriptionItems.id, context.id), eq(servicePrescriptionItems.version, expectedVersion))).run();
        if (deleted.changes !== 1) throw new Error('Service prescription item delete did not remove exactly one row');
        writeAuditEventInTransaction(tx, serviceAuditInput(context, 'host', 'service.prescription_item.deleted', 'service_prescription_item', context.id,
            { resourceVersion: expectedVersion }));
        return { status: 200, value: { success: true } };
    }, { behavior: 'immediate' });
}

/* @Codex */
export async function createNetworkScopedServicePrescription(context: NetworkPatientContext, rawBody: Record<string, unknown>): Promise<MutationResponse> {
    const parsed = servicePrescriptionCreateSchema.safeParse({ ...rawBody, patientId: context.patientId });
    if (!parsed.success) return badRequest('Payload non valido');
    const normalized = normalizeServicePrescriptionCreate(parsed.data);
    if (!normalized.ok) return badRequest(normalized.error);
    return dbServer.transaction((tx): MutationResponse => {
        if (!activeParentExists(tx, context.patientId) || !patientIsInScope(tx, context.patientId, context.scopeAmbulatoryId)) return { status: 404, value: { error: 'Not found' } };
        const inserted = tx.insert(servicePrescriptions).values(normalized.values).run();
        if (inserted.changes !== 1) throw new Error('Service prescription create did not write exactly one row');
        writeAuditEventInTransaction(tx, serviceAuditInput(context, 'network', 'service.prescription.created', 'service_prescription', normalized.values.id,
            { changedFields: listChangedFields(rawBody, ['id']), resourceVersion: 1 }));
        return { status: 201, value: { id: normalized.values.id, version: 1 } };
    }, { behavior: 'immediate' });
}

/* @Codex */
export async function updateNetworkScopedServicePrescription(context: NetworkPrescriptionContext, rawBody: Record<string, unknown>): Promise<MutationResponse> {
    const parsed = servicePrescriptionUpdateSchema.safeParse(rawBody);
    if (!parsed.success) return badRequest('Payload non valido');
    return updateServicePrescription({ ...context, id: context.prescriptionId }, parsed.data, 'network');
}

/* @Codex */
export async function createNetworkScopedServicePrescriptionItem(context: NetworkWriteContext, rawBody: Record<string, unknown>): Promise<MutationResponse> {
    const parsed = servicePrescriptionItemCreateSchema.safeParse(rawBody);
    if (!parsed.success) return badRequest('Payload non valido');
    return createServicePrescriptionItem(context, parsed.data, 'network');
}

/* @Codex */
export async function updateNetworkScopedServicePrescriptionItem(context: NetworkItemContext, rawBody: Record<string, unknown>): Promise<MutationResponse> {
    const parsed = servicePrescriptionItemUpdateSchema.safeParse(rawBody);
    if (!parsed.success) return badRequest('Payload non valido');
    return updateServicePrescriptionItem({ ...context, id: context.itemId }, parsed.data, 'network');
}

/* @Codex */
export async function readServiceCatalog(searchParams: URLSearchParams) {
    const q = searchParams.get('q')?.trim();
    const code = searchParams.get('code')?.trim().toUpperCase();
    const countOnly = searchParams.get('count') === '1';
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '40', 10) || 40, 1), 100);

    if (countOnly) {
        const row = await dbServer.select({ total: sql<number>`count(*)` }).from(serviceCatalogEntries).get();
        return { count: Number(row?.total || 0) };
    }
    if (code) {
        const row = await dbServer.select().from(serviceCatalogEntries).where(eq(serviceCatalogEntries.serviceCode, code)).get();
        return row ? [row] : [];
    }
    if (q) {
        const pattern = `%${q}%`;
        return dbServer.select()
            .from(serviceCatalogEntries)
            .where(sql`${serviceCatalogEntries.serviceCode} LIKE ${pattern} OR ${serviceCatalogEntries.displayName} LIKE ${pattern} OR ${serviceCatalogEntries.synonyms} LIKE ${pattern}`)
            .orderBy(asc(serviceCatalogEntries.displayName))
            .limit(limit);
    }
    return dbServer.select().from(serviceCatalogEntries).orderBy(asc(serviceCatalogEntries.displayName)).limit(limit);
}
