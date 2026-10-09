import { and, desc, eq, ne } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { dbServer } from './db-server';
import { dateInputSchema } from './api-schemas/common';
import { ambulatories, patients, patientsToAmbulatories } from './schema';
import { activePatients } from './patient-lifecycle';
import { clearTestContainerByMembership, TEST_CONTAINER_CLEAR_REASON } from './test-container-clear';
import { buildAmbulatoryVersionConflictPayload, parseExpectedVersion } from './ambulatory-concurrency';
/* @Codex */
import {
    auditContextFromSession, listChangedFields, requestIdFromRequest,
    withAuditContextMetadata, writeAuditEventInTransaction,
    type AuditEventType, type AuditRedactedMetadata, type AuditSubjectType,
} from './security/audit';
import type { NetworkWriteContext } from './network-write-context';
import type { ServerSession } from './security/server-session';

export type AmbulatoryMutationValue = Record<string, unknown>;
export type AmbulatoryMutationResponse = { status: 200 | 201 | 400 | 403 | 404 | 409; value: AmbulatoryMutationValue };

export type HostAmbulatoryContext = { request: Request; session: ServerSession };
type AmbulatoryWriteContext = HostAmbulatoryContext | NetworkWriteContext;
type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];

type AmbulatoryRow = typeof ambulatories.$inferSelect;

/* @Codex: only admitted session and paired context choose audit actor and surface. */
function ambulatoryAuditInput(
    context: AmbulatoryWriteContext,
    surface: 'host' | 'network',
    eventType: AuditEventType,
    subjectType: AuditSubjectType,
    subjectRef: string,
    metadata?: AuditRedactedMetadata | null,
) {
    const actor = auditContextFromSession(context.session);
    const flags = surface === 'network'
        ? [...(metadata?.flags ?? []), 'auth:paired-client',
            `paired-client:${(context as NetworkWriteContext).pairedClient.clientId}`, 'scope:ambulatory']
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

/* @Codex: every indirect default change is a durable versioned mutation. */
function auditDefaultChange(tx: Tx, context: AmbulatoryWriteContext, surface: 'host' | 'network', id: string, version: number) {
    writeAuditEventInTransaction(tx, ambulatoryAuditInput(context, surface, 'ambulatory.updated', 'ambulatory', id,
        { changedFields: ['isDefault'], resourceVersion: version }));
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(body, key);
}

function nullableText(value: unknown, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
    if (typeof value === 'string') return { ok: true, value: value.trim().length === 0 ? null : value };
    if (value === null || value === '') return { ok: true, value: null };
    return { ok: false, error: `Invalid ${label} value` };
}

function normalizeType(value: unknown, allowUndefined: boolean): 'live' | 'test' | undefined | null {
    if (value === undefined && allowUndefined) return undefined;
    if (value === undefined || value === null || value === '') return 'live';
    return value === 'live' || value === 'test' ? value : null;
}

function conflictSnapshot(row: AmbulatoryRow | undefined): AmbulatoryRow | null {
    return row ?? null;
}

function affected(row: Pick<AmbulatoryRow, 'id' | 'version'>): { id: string; version: number } {
    return { id: row.id, version: row.version };
}

function selectAmbulatory(tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0], id: string): AmbulatoryRow | undefined {
    return tx.select().from(ambulatories).where(eq(ambulatories.id, id)).get();
}

function validateParent(
    tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0],
    parentId: string | null,
    id: string,
): AmbulatoryMutationResponse | null {
    if (!parentId) return null;
    if (parentId === id) return { status: 400, value: { error: 'parentId cannot reference itself' } };
    if (!selectAmbulatory(tx, parentId)) return { status: 404, value: { error: 'Parent ambulatory not found' } };
    return null;
}

/* @Codex */
export function createAmbulatory(context: AmbulatoryWriteContext, rawBody: Record<string, unknown>, surface: 'host' | 'network' = 'host'): AmbulatoryMutationResponse {
    const name = typeof rawBody.name === 'string' ? rawBody.name.trim() : '';
    if (!name) return { status: 400, value: { error: 'Ambulatory name is required' } };
    const type = normalizeType(rawBody.type, false);
    if (!type) return { status: 400, value: { error: 'Invalid ambulatory type' } };
    if (hasOwn(rawBody, 'id') && (typeof rawBody.id !== 'string' || !rawBody.id.trim())) {
        return { status: 400, value: { error: 'Invalid ambulatory id' } };
    }
    const id = hasOwn(rawBody, 'id') ? (rawBody.id as string).trim() : uuidv4();
    if (hasOwn(rawBody, 'isDefault') && typeof rawBody.isDefault !== 'boolean') {
        return { status: 400, value: { error: 'Invalid isDefault value' } };
    }
    let createdAt = new Date();
    if (hasOwn(rawBody, 'createdAt')) {
        const parsedDate = dateInputSchema.safeParse(rawBody.createdAt);
        if (!parsedDate.success) return { status: 400, value: { error: 'Invalid createdAt' } };
        createdAt = new Date(parsedDate.data);
    }
    const parentValue = hasOwn(rawBody, 'parentId') ? nullableText(rawBody.parentId, 'parentId') : { ok: true as const, value: null };
    if (!parentValue.ok) return { status: 400, value: { error: parentValue.error } };
    const addressValue = hasOwn(rawBody, 'address') ? nullableText(rawBody.address, 'address') : { ok: true as const, value: null };
    if (!addressValue.ok) return { status: 400, value: { error: addressValue.error } };
    const descriptionValue = hasOwn(rawBody, 'description') ? nullableText(rawBody.description, 'description') : { ok: true as const, value: null };
    if (!descriptionValue.ok) return { status: 400, value: { error: descriptionValue.error } };

    return dbServer.transaction((tx): AmbulatoryMutationResponse => {
        if (selectAmbulatory(tx, id)) return { status: 409, value: { error: 'Ambulatory id already exists' } };
        const parentError = validateParent(tx, parentValue.value, id);
        if (parentError) return parentError;
        const currentDefaults = tx.select().from(ambulatories).where(eq(ambulatories.isDefault, true)).all();
        const shouldBeDefault = rawBody.isDefault === true || currentDefaults.length === 0;
        const affectedRows: Array<{ id: string; version: number }> = [];
        if (shouldBeDefault) {
            for (const currentDefault of currentDefaults) {
                const demoted = tx.update(ambulatories).set({ isDefault: false, version: currentDefault.version + 1 })
                    .where(and(eq(ambulatories.id, currentDefault.id), eq(ambulatories.version, currentDefault.version))).run();
                if (demoted.changes !== 1) throw new Error('Ambulatory default demotion did not update exactly one row');
                auditDefaultChange(tx, context, surface, currentDefault.id, currentDefault.version + 1);
                affectedRows.push({ id: currentDefault.id, version: currentDefault.version + 1 });
            }
        }
        const inserted = tx.insert(ambulatories).values({
            id, name, address: addressValue.value, parentId: parentValue.value, type,
            description: descriptionValue.value, isDefault: shouldBeDefault, version: 1, createdAt,
        }).run();
        if (inserted.changes !== 1) throw new Error('Ambulatory create did not write exactly one row');
        writeAuditEventInTransaction(tx, ambulatoryAuditInput(context, surface, 'ambulatory.created', 'ambulatory', id,
            { changedFields: listChangedFields(rawBody, ['id']), resourceVersion: 1 }));
        return { status: 201, value: { success: true, id, version: 1, affectedAmbulatories: [...affectedRows, { id, version: 1 }] } };
    }, { behavior: 'immediate' });
}

/* @Codex */
export function updateAmbulatory(context: AmbulatoryWriteContext, id: string, rawBody: Record<string, unknown>, surface: 'host' | 'network' = 'host'): AmbulatoryMutationResponse {
    const expectedVersion = parseExpectedVersion(rawBody.version);
    if (expectedVersion === null) return { status: 400, value: { error: 'Version is required' } };
    return dbServer.transaction((tx): AmbulatoryMutationResponse => {
        const existing = selectAmbulatory(tx, id);
        if (!existing) return { status: 404, value: { error: 'Not found' } };
        if (existing.version !== expectedVersion) return { status: 409, value: buildAmbulatoryVersionConflictPayload(expectedVersion, id, conflictSnapshot(existing)) };

        const updateData: Partial<typeof ambulatories.$inferInsert> = {};
        if (hasOwn(rawBody, 'name')) {
            if (typeof rawBody.name !== 'string' || !rawBody.name.trim()) return { status: 400, value: { error: 'Ambulatory name cannot be empty' } };
            updateData.name = rawBody.name.trim();
        }
        for (const field of ['address', 'description'] as const) {
            if (!hasOwn(rawBody, field)) continue;
            const parsed = nullableText(rawBody[field], field);
            if (!parsed.ok) return { status: 400, value: { error: parsed.error } };
            updateData[field] = parsed.value;
        }
        if (hasOwn(rawBody, 'parentId')) {
            const parsed = nullableText(rawBody.parentId, 'parentId');
            if (!parsed.ok) return { status: 400, value: { error: parsed.error } };
            const parentError = validateParent(tx, parsed.value, id);
            if (parentError) return parentError;
            updateData.parentId = parsed.value;
        }
        const parsedType = normalizeType(rawBody.type, true);
        if (parsedType === null) return { status: 400, value: { error: 'Invalid ambulatory type' } };
        if (parsedType !== undefined) updateData.type = parsedType;
        if (hasOwn(rawBody, 'isDefault')) {
            if (typeof rawBody.isDefault !== 'boolean') return { status: 400, value: { error: 'Invalid isDefault value' } };
            if (rawBody.isDefault === false && existing.isDefault) {
                return { status: 409, value: { error: 'Cannot unset default directly. Set another ambulatory as default first.' } };
            }
            updateData.isDefault = rawBody.isDefault;
        }
        if (Object.keys(updateData).length === 0) return { status: 400, value: { error: 'No valid fields to update' } };

        const affectedRows: Array<{ id: string; version: number }> = [];
        if (updateData.isDefault === true && !existing.isDefault) {
            const currentDefaults = tx.select().from(ambulatories)
                .where(and(eq(ambulatories.isDefault, true), ne(ambulatories.id, id))).all();
            for (const currentDefault of currentDefaults) {
                const demoted = tx.update(ambulatories).set({ isDefault: false, version: currentDefault.version + 1 })
                    .where(and(eq(ambulatories.id, currentDefault.id), eq(ambulatories.version, currentDefault.version))).run();
                if (demoted.changes !== 1) throw new Error('Ambulatory default demotion did not update exactly one row');
                auditDefaultChange(tx, context, surface, currentDefault.id, currentDefault.version + 1);
                affectedRows.push({ id: currentDefault.id, version: currentDefault.version + 1 });
            }
        }
        const nextVersion = expectedVersion + 1;
        const committed = tx.update(ambulatories).set({ ...updateData, version: nextVersion })
            .where(and(eq(ambulatories.id, id), eq(ambulatories.version, expectedVersion))).run();
        if (committed.changes !== 1) throw new Error('Ambulatory update did not write exactly one row');
        writeAuditEventInTransaction(tx, ambulatoryAuditInput(context, surface, 'ambulatory.updated', 'ambulatory', id,
            { changedFields: listChangedFields(rawBody, ['version']), resourceVersion: nextVersion }));
        return { status: 200, value: { success: true, version: nextVersion, affectedAmbulatories: [...affectedRows, { id, version: nextVersion }] } };
    }, { behavior: 'immediate' });
}

/* @Codex */
export function deleteAmbulatory(context: AmbulatoryWriteContext, id: string, expectedVersion: unknown, surface: 'host' | 'network' = 'host'): AmbulatoryMutationResponse {
    const parsedVersion = parseExpectedVersion(expectedVersion);
    if (parsedVersion === null) return { status: 400, value: { error: 'Version is required' } };
    return dbServer.transaction((tx): AmbulatoryMutationResponse => {
        const existing = selectAmbulatory(tx, id);
        if (!existing) return { status: 404, value: { error: 'Not found' } };
        if (existing.version !== parsedVersion) return { status: 409, value: buildAmbulatoryVersionConflictPayload(parsedVersion, id, conflictSnapshot(existing)) };
        const linkedPrimaryPatient = tx.select({ id: patients.id }).from(patients)
            .where(and(eq(patients.ambulatoryId, id), activePatients())).get();
        const linkedPatientAssignment = tx.select({ patientId: patientsToAmbulatories.patientId }).from(patientsToAmbulatories)
            .where(eq(patientsToAmbulatories.ambulatoryId, id)).get();
        if (linkedPrimaryPatient || linkedPatientAssignment) {
            return { status: 409, value: { error: 'Ambulatory still has linked patients. Move/unassign patients before deletion.' } };
        }
        let fallback: AmbulatoryRow | undefined;
        if (existing.isDefault) {
            fallback = tx.select().from(ambulatories).where(ne(ambulatories.id, id)).orderBy(desc(ambulatories.createdAt)).get();
            if (!fallback) return { status: 409, value: { error: 'Cannot delete the last ambulatory' } };
        }
        const affectedRows: Array<{ id: string; version: number }> = [];
        if (fallback) {
            const promoted = tx.update(ambulatories).set({ isDefault: true, version: fallback.version + 1 })
                .where(and(eq(ambulatories.id, fallback.id), eq(ambulatories.version, fallback.version))).run();
            if (promoted.changes !== 1) throw new Error('Ambulatory fallback promotion did not update exactly one row');
            auditDefaultChange(tx, context, surface, fallback.id, fallback.version + 1);
            affectedRows.push({ id: fallback.id, version: fallback.version + 1 });
        }
        const deleted = tx.delete(ambulatories).where(and(eq(ambulatories.id, id), eq(ambulatories.version, parsedVersion))).run();
        if (deleted.changes !== 1) throw new Error('Ambulatory delete did not remove exactly one row');
        writeAuditEventInTransaction(tx, ambulatoryAuditInput(context, surface, 'ambulatory.deleted', 'ambulatory', id,
            { resourceVersion: parsedVersion }));
        return { status: 200, value: { success: true, affectedAmbulatories: affectedRows } };
    }, { behavior: 'immediate' });
}

/* @Codex */
export async function clearAmbulatory(
    context: AmbulatoryWriteContext,
    ambulatoryId: string,
    expectedVersion: unknown,
    surface: 'host' | 'network' = 'host',
): Promise<AmbulatoryMutationResponse> {
    const parsedVersion = parseExpectedVersion(expectedVersion);
    if (parsedVersion === null) return { status: 400, value: { error: 'Version is required' } };
    if (context.session.role !== 'admin') return { status: 403, value: { error: 'Forbidden' } };
    return dbServer.transaction((tx): AmbulatoryMutationResponse => {
        const target = selectAmbulatory(tx, ambulatoryId);
        if (!target) return { status: 404, value: { error: 'Ambulatory not found' } };
        if (target.version !== parsedVersion) return { status: 409, value: buildAmbulatoryVersionConflictPayload(parsedVersion, ambulatoryId, conflictSnapshot(target)) };
        if (target.type !== 'test') return { status: 403, value: { error: 'Safety Check: Cannot clear a LIVE ambulatory' } };
        const guarded = tx.update(ambulatories).set({ version: target.version + 1 })
            .where(and(eq(ambulatories.id, ambulatoryId), eq(ambulatories.version, parsedVersion))).run();
        if (guarded.changes !== 1) throw new Error('Test-container version guard did not update exactly one row');
        const result = clearTestContainerByMembership(tx, ambulatoryId);
        for (const patient of result.clearedPatients) {
            writeAuditEventInTransaction(tx, ambulatoryAuditInput(context, surface, 'patient.deleted', 'patient', patient.id,
                { reasonCode: TEST_CONTAINER_CLEAR_REASON, resourceVersion: patient.version }));
        }
        for (const patient of result.unlinkedPatients) {
            writeAuditEventInTransaction(tx, ambulatoryAuditInput(context, surface, 'patient.updated', 'patient', patient.id,
                { changedFields: ['ambulatoryMemberships'], resourceVersion: patient.version, flags: ['membership:unassigned'] }));
        }
        writeAuditEventInTransaction(tx, ambulatoryAuditInput(context, surface, 'ambulatory.cleared', 'ambulatory', ambulatoryId,
            { resourceVersion: target.version + 1 }));
        return {
            status: 200,
            value: {
                success: true, message: 'Test container cleared', version: target.version + 1,
                clearedPatients: result.clearedPatients.length,
                preservedLivePatients: result.preservedLivePatientIds.length,
                removedMembershipRows: result.removedMembershipRows,
            },
        };
    }, { behavior: 'immediate' });
}
