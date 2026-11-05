import { eq, isNull } from 'drizzle-orm';
import type { dbServer } from './db-server';
import { patients, patientsToAmbulatories } from './schema';
import { normalizeIdentifierValue, type PatientIdentifierType } from './patient-identity';

type Reader = Pick<typeof dbServer, 'select'>;
export { PATIENT_IDENTIFIER_DUPLICATE, PatientIdentifierConflictError } from './patient-identity';
export function hasPatientIdentifierConflict(tx: Reader, input: {
    id: string; identifierType: PatientIdentifierType; taxCode: string; ambulatoryId?: string | null;
}): boolean {
    if (input.identifierType === 'none' || !input.taxCode) return false;
    const scopes = new Set(tx.select().from(patientsToAmbulatories).where(eq(patientsToAmbulatories.patientId, input.id)).all().map(row => row.ambulatoryId));
    if (input.ambulatoryId) scopes.add(input.ambulatoryId);
    if (!scopes.size) return false;
    const value = normalizeIdentifierValue(input.identifierType, input.taxCode);
    return tx.select().from(patients).where(isNull(patients.deletedAt)).all().some(row => {
        if (row.id === input.id || row.identifierType !== input.identifierType || normalizeIdentifierValue(row.identifierType, row.taxCode) !== value) return false;
        if (row.ambulatoryId && scopes.has(row.ambulatoryId)) return true;
        return tx.select().from(patientsToAmbulatories).where(eq(patientsToAmbulatories.patientId, row.id)).all().some(membership => scopes.has(membership.ambulatoryId));
    });
}
