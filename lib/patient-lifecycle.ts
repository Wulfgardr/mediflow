// WUL-306 (ADR 0066): patient soft-delete lifecycle helpers.
import { isNull } from 'drizzle-orm';
import { patients } from './schema';

// Shared read predicate: every UI/API patient read path must exclude tombstoned rows.
// backup-restore, fix-orphans, migrate and purge-patient deliberately do NOT filter.
export function activePatients() {
    return isNull(patients.deletedAt);
}

export type PatientTombstoneValues = Pick<
    typeof patients.$inferInsert,
    'deletedAt' | 'deletionReason' | 'version' | 'updatedAt'
>;

// WUL-306: DELETE keeps the soft-delete tombstone (donor: WUL-308 entries handler).
// The version bump mirrors normalizePatientUpdateInput so the 409 contract is unchanged.
export function buildPatientTombstoneValues(
    expectedVersion: number,
    deletionReason: string,
    now: Date = new Date()
): PatientTombstoneValues {
    return {
        deletedAt: now,
        deletionReason,
        version: expectedVersion + 1,
        updatedAt: now,
    };
}

// Restore clears the tombstone and bumps the version so stale clients still conflict.
export function buildPatientRestoreValues(
    currentVersion: number,
    now: Date = new Date()
): PatientTombstoneValues {
    return {
        deletedAt: null,
        deletionReason: null,
        version: currentVersion + 1,
        updatedAt: now,
    };
}
