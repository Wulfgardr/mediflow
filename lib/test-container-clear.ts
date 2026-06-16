// WUL-322 (ADR 0066, Slice 3): membership-based clear of a test container.
// Selection goes through patientsToAmbulatories ONLY: the stale legacy
// ambulatory column on patients must never pick deletion sets (WUL-300).
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { ambulatories, patients, patientsToAmbulatories } from './schema';
import { activePatients, buildPatientTombstoneValues } from './patient-lifecycle';

export const TEST_CONTAINER_CLEAR_REASON = 'test-container-clear';

export type ClearedTestPatient = { id: string; version: number };

export type TestContainerClearResult = {
    // Tombstoned by this clear (test-only members), with their pre-tombstone version.
    clearedPatients: ClearedTestPatient[];
    // Members that also hold a live membership: they only lose the test link.
    preservedLivePatientIds: string[];
    removedMembershipRows: number;
};

// Works both on dbServer and on a synchronous better-sqlite3 transaction.
type TestContainerClearRunner = Pick<BetterSQLite3Database, 'select' | 'update' | 'delete'>;

// Clears one TEST ambulatory (the caller owns the type==='test' safety check):
// 1. members = patients linked to the container via M2M membership;
// 2. members that also hold a membership in a live (non-test) ambulatory are
//    preserved: they only lose the test-container join row, never the patient;
// 3. test-only members are SOFT-deleted (WUL-306 tombstone, never a hard delete)
//    with deletionReason='test-container-clear', children left intact;
// 4. every join row of the cleared container is removed.
// Run inside dbServer.transaction so a mid-flight failure rolls back atomically.
export function clearTestContainerByMembership(
    runner: TestContainerClearRunner,
    ambulatoryId: string,
    now: Date = new Date()
): TestContainerClearResult {
    const memberIds = [...new Set(
        runner
            .select({ patientId: patientsToAmbulatories.patientId })
            .from(patientsToAmbulatories)
            .where(eq(patientsToAmbulatories.ambulatoryId, ambulatoryId))
            .all()
            .map((row) => row.patientId)
    )];

    // Exclusion rule (ADR 0066 punto 4): any membership in a non-test ambulatory
    // keeps the patient. A NULL type counts as live: when in doubt, never delete.
    const liveMemberIds = new Set(
        memberIds.length === 0
            ? []
            : runner
                .select({ patientId: patientsToAmbulatories.patientId })
                .from(patientsToAmbulatories)
                .innerJoin(ambulatories, eq(patientsToAmbulatories.ambulatoryId, ambulatories.id))
                .where(and(
                    inArray(patientsToAmbulatories.patientId, memberIds),
                    ne(patientsToAmbulatories.ambulatoryId, ambulatoryId),
                    or(isNull(ambulatories.type), ne(ambulatories.type, 'test'))
                ))
                .all()
                .map((row) => row.patientId)
    );

    const testOnlyIds = memberIds.filter((patientId) => !liveMemberIds.has(patientId));

    // Already-tombstoned members keep their original tombstone untouched.
    const activeTestOnly = testOnlyIds.length === 0
        ? []
        : runner
            .select({ id: patients.id, version: patients.version })
            .from(patients)
            .where(and(inArray(patients.id, testOnlyIds), activePatients()))
            .all();

    const clearedPatients: ClearedTestPatient[] = [];
    for (const patient of activeTestOnly) {
        const tombstone = runner
            .update(patients)
            .set(buildPatientTombstoneValues(patient.version, TEST_CONTAINER_CLEAR_REASON, now))
            .where(and(eq(patients.id, patient.id), eq(patients.version, patient.version), activePatients()))
            .run();
        if (tombstone.changes === 1) {
            clearedPatients.push({ id: patient.id, version: patient.version });
        }
    }

    const removedMembershipRows = runner
        .delete(patientsToAmbulatories)
        .where(eq(patientsToAmbulatories.ambulatoryId, ambulatoryId))
        .run()
        .changes;

    return {
        clearedPatients,
        preservedLivePatientIds: memberIds.filter((patientId) => liveMemberIds.has(patientId)),
        removedMembershipRows,
    };
}
