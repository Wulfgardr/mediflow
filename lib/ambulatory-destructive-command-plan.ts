import { createHash } from 'node:crypto';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { dbServer } from './db-server';
import { ambulatories, auditEvents, patients, patientsToAmbulatories } from './schema';
import { inspectTestContainerByMembership } from './test-container-clear';
import { activePatients } from './patient-lifecycle';
import { canIncrementVersion } from './version-concurrency';
import type { AmbulatoryCommandMarker } from './ambulatory-destructive-command-contract';

export type AmbulatoryPlanBinding = Omit<AmbulatoryCommandMarker, 'planDigest'> & {
    actorRef: string; deviceId: string; devicePlatform: string; deviceTokenHash: string;
};
type Runner = Pick<typeof dbServer, 'select'>;
const sort = <T>(rows: T[]): T[] => rows.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
const seconds = (date: Date | null): number | null => date === null ? null : date.getTime() / 1000;
export function inspectAmbulatoryDestructivePlan(tx: Runner, binding: AmbulatoryPlanBinding) {
    const target = tx.select().from(ambulatories).where(eq(ambulatories.id, binding.ambulatoryId)).get();
    const targetSnapshot = target ? { id: target.id, version: target.version, name: target.name, type: target.type,
        isDefault: target.isDefault, parentId: target.parentId, createdAt: seconds(target.createdAt) } : null;
    let reason: string | null = !target ? 'target_missing' : target.version !== binding.expectedVersion ? 'version_conflict' : null;
    let clear: ReturnType<typeof inspectTestContainerByMembership> | null = null;
    let clearSnapshot: unknown = null;
    let deleteSnapshot: unknown = null;
    let fallback: typeof target = undefined;
    if (binding.operation === 'ambulatory.clear-test.v1') {
        clear = inspectTestContainerByMembership(tx, binding.ambulatoryId);
        const memberships = clear.memberIds.length === 0 ? [] : tx.select({ patientId: patientsToAmbulatories.patientId,
            ambulatoryId: patientsToAmbulatories.ambulatoryId, assignedAt: patientsToAmbulatories.assignedAt })
            .from(patientsToAmbulatories).where(inArray(patientsToAmbulatories.patientId, clear.memberIds)).all();
        const relevant = [...new Set(memberships.map(row => row.ambulatoryId))];
        const kinds = relevant.length === 0 ? [] : tx.select({ id: ambulatories.id, version: ambulatories.version, type: ambulatories.type })
            .from(ambulatories).where(inArray(ambulatories.id, relevant)).all();
        const lifecycle = clear.memberIds.length === 0 ? [] : tx.select({ id: patients.id, version: patients.version,
            deletedAt: patients.deletedAt, deletionReason: patients.deletionReason }).from(patients)
            .where(inArray(patients.id, clear.memberIds)).all();
        clearSnapshot = { members: [...clear.memberIds].sort(), memberships: sort(memberships.map(row => ({ ...row, assignedAt: seconds(row.assignedAt) }))),
            kinds: sort(kinds), lifecycle: sort(lifecycle.map(row => ({ ...row, deletedAt: seconds(row.deletedAt) }))),
            tombstone: sort([...clear.activeTestOnly]), unlink: sort([...clear.remainingPatients]), live: [...clear.liveMemberIds].sort() };
        if (!reason && target!.type !== 'test') reason = 'test_only';
        if (!reason && (!canIncrementVersion(target!.version) || [...clear.activeTestOnly, ...clear.remainingPatients].some(row => !canIncrementVersion(row.version)))) reason = 'version_exhausted';
    } else {
        const primary = tx.select({ id: patients.id, version: patients.version }).from(patients)
            .where(and(eq(patients.ambulatoryId, binding.ambulatoryId), activePatients())).all();
        const memberships = tx.select({ patientId: patientsToAmbulatories.patientId, assignedAt: patientsToAmbulatories.assignedAt })
            .from(patientsToAmbulatories).where(eq(patientsToAmbulatories.ambulatoryId, binding.ambulatoryId)).all();
        const children = tx.select({ id: ambulatories.id, version: ambulatories.version, parentId: ambulatories.parentId })
            .from(ambulatories).where(eq(ambulatories.parentId, binding.ambulatoryId)).all();
        const candidates = target?.isDefault ? tx.select().from(ambulatories).where(ne(ambulatories.id, binding.ambulatoryId)).all() : [];
        candidates.sort((a, b) => (b.createdAt?.getTime() ?? -Infinity) - (a.createdAt?.getTime() ?? -Infinity));
        fallback = candidates[0];
        deleteSnapshot = { primary: sort(primary), memberships: sort(memberships.map(row => ({ ...row, assignedAt: seconds(row.assignedAt) }))),
            children: sort(children), candidates: sort(candidates.map(row => ({ id: row.id, version: row.version, name: row.name,
                createdAt: seconds(row.createdAt), isDefault: row.isDefault }))) };
        if (!reason && (primary.length || memberships.length)) reason = 'linked_patients';
        if (!reason && children.length) reason = 'child_ambulatories';
        if (!reason && target!.isDefault && !fallback) reason = 'last_default';
        if (!reason && fallback && candidates.filter(row => seconds(row.createdAt) === seconds(fallback!.createdAt)).length > 1) reason = 'fallback_ambiguous';
        if (!reason && fallback && !canIncrementVersion(fallback.version)) reason = 'version_exhausted';
    }
    const identities = [binding.ambulatoryId, ...(fallback ? [fallback.id] : [])].sort();
    const audit = tx.select({ eventId: auditEvents.eventId, subjectRef: auditEvents.subjectRef, eventType: auditEvents.eventType })
        .from(auditEvents).where(and(eq(auditEvents.subjectType, 'ambulatory'), eq(auditEvents.outcome, 'success'),
            inArray(auditEvents.subjectRef, identities), inArray(auditEvents.eventType, ['ambulatory.created', 'ambulatory.deleted']))).all();
    const snapshot = { binding, target: targetSnapshot, clear: clearSnapshot, deletion: deleteSnapshot, audit: sort(audit), reason };
    const planDigest = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    return { snapshot, planDigest, reason, target: targetSnapshot, fallback: fallback ? { id: fallback.id, version: fallback.version, name: fallback.name } : null,
        counts: clear ? { tombstonedPatients: clear.activeTestOnly.length, unlinkedPatients: clear.remainingPatients.length,
            preservedLivePatients: clear.liveMemberIds.length, removedMembershipRows: clear.memberIds.length } : null };
}
