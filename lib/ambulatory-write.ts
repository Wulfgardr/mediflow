import { and, desc, eq, ne } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { dbServer } from './db-server';
import { ambulatories, patients, patientsToAmbulatories } from './schema';
import { activePatients } from './patient-lifecycle';
import { clearTestContainerByMembership, TEST_CONTAINER_CLEAR_REASON } from './test-container-clear';
import { buildAmbulatoryVersionConflictPayload, parseExpectedVersion } from './ambulatory-concurrency';
import { safeWriteAuditEventFromRequest } from './security/audit';
import type { ServerSession } from './security/server-session';

export type AmbulatoryMutationValue = Record<string, unknown>;
export type AmbulatoryMutationResponse = { status: 200 | 201 | 400 | 403 | 404 | 409; value: AmbulatoryMutationValue };

export type HostAmbulatoryContext = { request: Request; session: ServerSession };

type AmbulatoryRow = typeof ambulatories.$inferSelect;

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

export function createAmbulatory(rawBody: Record<string, unknown>): AmbulatoryMutationResponse {
    const name = typeof rawBody.name === 'string' ? rawBody.name.trim() : '';
    if (!name) return { status: 400, value: { error: 'Ambulatory name is required' } };
    const type = normalizeType(rawBody.type, false);
    if (!type) return { status: 400, value: { error: 'Invalid ambulatory type' } };
    const id = typeof rawBody.id === 'string' && rawBody.id.trim() ? rawBody.id.trim() : uuidv4();
    const createdAt = rawBody.createdAt === undefined ? new Date() : new Date(rawBody.createdAt as string | number | Date);
    if (Number.isNaN(createdAt.getTime())) return { status: 400, value: { error: 'Invalid createdAt' } };
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
                tx.update(ambulatories).set({ isDefault: false, version: currentDefault.version + 1 })
                    .where(and(eq(ambulatories.id, currentDefault.id), eq(ambulatories.version, currentDefault.version))).run();
                affectedRows.push({ id: currentDefault.id, version: currentDefault.version + 1 });
            }
        }
        tx.insert(ambulatories).values({
            id, name, address: addressValue.value, parentId: parentValue.value, type,
            description: descriptionValue.value, isDefault: shouldBeDefault, version: 1, createdAt,
        }).run();
        return { status: 201, value: { success: true, id, version: 1, affectedAmbulatories: [...affectedRows, { id, version: 1 }] } };
    });
}

export function updateAmbulatory(id: string, rawBody: Record<string, unknown>): AmbulatoryMutationResponse {
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
                tx.update(ambulatories).set({ isDefault: false, version: currentDefault.version + 1 })
                    .where(and(eq(ambulatories.id, currentDefault.id), eq(ambulatories.version, currentDefault.version))).run();
                affectedRows.push({ id: currentDefault.id, version: currentDefault.version + 1 });
            }
        }
        const nextVersion = expectedVersion + 1;
        const committed = tx.update(ambulatories).set({ ...updateData, version: nextVersion })
            .where(and(eq(ambulatories.id, id), eq(ambulatories.version, expectedVersion))).run();
        if (committed.changes !== 1) {
            return { status: 409, value: buildAmbulatoryVersionConflictPayload(expectedVersion, id, conflictSnapshot(selectAmbulatory(tx, id))) };
        }
        return { status: 200, value: { success: true, version: nextVersion, affectedAmbulatories: [...affectedRows, { id, version: nextVersion }] } };
    });
}

export function deleteAmbulatory(id: string, expectedVersion: unknown): AmbulatoryMutationResponse {
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
            tx.update(ambulatories).set({ isDefault: true, version: fallback.version + 1 })
                .where(and(eq(ambulatories.id, fallback.id), eq(ambulatories.version, fallback.version))).run();
            affectedRows.push({ id: fallback.id, version: fallback.version + 1 });
        }
        const deleted = tx.delete(ambulatories).where(and(eq(ambulatories.id, id), eq(ambulatories.version, parsedVersion))).run();
        if (deleted.changes !== 1) return { status: 409, value: buildAmbulatoryVersionConflictPayload(parsedVersion, id, conflictSnapshot(selectAmbulatory(tx, id))) };
        return { status: 200, value: { success: true, affectedAmbulatories: affectedRows } };
    });
}

export async function clearAmbulatory(context: HostAmbulatoryContext, ambulatoryId: string, expectedVersion: unknown): Promise<AmbulatoryMutationResponse> {
    const parsedVersion = parseExpectedVersion(expectedVersion);
    if (parsedVersion === null) return { status: 400, value: { error: 'Version is required' } };
    if (context.session.role !== 'admin') return { status: 403, value: { error: 'Forbidden' } };
    const commit = dbServer.transaction((tx): AmbulatoryMutationResponse => {
        const target = selectAmbulatory(tx, ambulatoryId);
        if (!target) return { status: 404, value: { error: 'Ambulatory not found' } };
        if (target.version !== parsedVersion) return { status: 409, value: buildAmbulatoryVersionConflictPayload(parsedVersion, ambulatoryId, conflictSnapshot(target)) };
        if (target.type !== 'test') return { status: 403, value: { error: 'Safety Check: Cannot clear a LIVE ambulatory' } };
        const guarded = tx.update(ambulatories).set({ version: target.version + 1 })
            .where(and(eq(ambulatories.id, ambulatoryId), eq(ambulatories.version, parsedVersion))).run();
        if (guarded.changes !== 1) return { status: 409, value: buildAmbulatoryVersionConflictPayload(parsedVersion, ambulatoryId, conflictSnapshot(selectAmbulatory(tx, ambulatoryId))) };
        const result = clearTestContainerByMembership(tx, ambulatoryId);
        return {
            status: 200,
            value: {
                success: true, message: 'Test container cleared', version: target.version + 1,
                clearedPatients: result.clearedPatients.length,
                preservedLivePatients: result.preservedLivePatientIds.length,
                removedMembershipRows: result.removedMembershipRows,
                clearedPatientVersions: result.clearedPatients,
            },
        };
    });
    if (commit.status !== 200) return commit;
    const cleared = Array.isArray(commit.value.clearedPatientVersions) ? commit.value.clearedPatientVersions : [];
    for (const item of cleared) {
        if (!item || typeof item !== 'object') continue;
        const patient = item as { id?: unknown; version?: unknown };
        if (typeof patient.id !== 'string' || typeof patient.version !== 'number') continue;
        await safeWriteAuditEventFromRequest(context.request, context.session, {
            eventType: 'patient.deleted', subjectType: 'patient', subjectRef: patient.id,
            redactedMetadata: { reasonCode: TEST_CONTAINER_CLEAR_REASON, resourceVersion: patient.version },
        }, '[MediFlow] Test-container clear audit write failed:');
    }
    delete commit.value.clearedPatientVersions;
    return commit;
}
