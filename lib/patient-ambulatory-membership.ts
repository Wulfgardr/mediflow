import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { patientsToAmbulatories } from './schema';

// WUL-309: `ambulatoryId` on a patient-profile PUT means "set the primary
// ambulatory", NOT "replace every membership". A profile write only upserts the
// targeted (patientId, ambulatoryId) row in patients_to_ambulatories and never
// deletes the patient's other ambulatory associations. The denormalized
// patients.ambulatory_id column is updated alongside the patient row via
// normalizePatientUpdateInput, which shares the same validation below.

type PatientMembershipDb =
    | BetterSQLite3Database
    | Parameters<Parameters<BetterSQLite3Database['transaction']>[0]>[0];

export function resolvePrimaryAmbulatoryId(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

// Update-time normalization for the denormalized patients.ambulatory_id column:
// a non-empty string sets the primary, an explicit `null` clears it, anything
// else (blank or non-string) is a no-op so the column cannot drift away from
// the join table.
export function normalizePrimaryAmbulatoryIdInput(value: unknown): string | null | undefined {
    if (value === null) return null;
    return resolvePrimaryAmbulatoryId(value) ?? undefined;
}

export function upsertPrimaryAmbulatoryMembership(
    db: PatientMembershipDb,
    patientId: string,
    ambulatoryId: unknown
): string | null {
    const primaryAmbulatoryId = resolvePrimaryAmbulatoryId(ambulatoryId);
    if (primaryAmbulatoryId === null) return null;

    db.insert(patientsToAmbulatories)
        .values({
            patientId,
            ambulatoryId: primaryAmbulatoryId,
            assignedAt: new Date(),
        })
        .onConflictDoNothing()
        .run();

    return primaryAmbulatoryId;
}
