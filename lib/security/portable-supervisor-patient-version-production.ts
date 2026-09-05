/* @Codex */
import 'server-only';

import { and, eq } from 'drizzle-orm';

import { dbServer } from '../db-server';
import { activePatients } from '../patient-lifecycle';
import { ambulatories, patients, patientsToAmbulatories } from '../schema';

type PatientVersionDatabase = Pick<typeof dbServer, 'select'>;

export class PortableSupervisorPatientVersionProductionV1Error extends Error {
  constructor(readonly code: 'input_invalid' | 'patient_unavailable' | 'patient_version_invalid') {
    super(`Portable supervisor patient version rejected: ${code}`);
    this.name = 'PortableSupervisorPatientVersionProductionV1Error';
  }
}

function fail(code: 'input_invalid' | 'patient_unavailable' | 'patient_version_invalid'): never {
  throw new PortableSupervisorPatientVersionProductionV1Error(code);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

/** Returns the current version only while the exact live patient/ambulatory membership still exists. */
export function createPortableSupervisorPatientVersionProductionV1(
  database: PatientVersionDatabase = dbServer,
): (patientId: string, ambulatoryId: string) => number {
  return (patientId: string, ambulatoryId: string): number => {
    if (!validId(patientId) || !validId(ambulatoryId)) return fail('input_invalid');
    let rows: Array<{ version: number }>;
    try {
      rows = database.select({ version: patients.version })
        .from(patients)
        .innerJoin(patientsToAmbulatories, and(
          eq(patientsToAmbulatories.patientId, patients.id),
          eq(patientsToAmbulatories.ambulatoryId, ambulatoryId),
        ))
        .innerJoin(ambulatories, and(
          eq(ambulatories.id, patientsToAmbulatories.ambulatoryId),
          eq(ambulatories.id, ambulatoryId),
        ))
        .where(and(
          eq(patients.id, patientId),
          eq(patients.isArchived, false),
          activePatients(),
        ))
        .limit(2)
        .all();
    } catch { return fail('patient_unavailable'); }
    if (rows.length !== 1) return fail('patient_unavailable');
    const version = rows[0]?.version;
    if (!Number.isSafeInteger(version) || version < 1) return fail('patient_version_invalid');
    return version;
  };
}
