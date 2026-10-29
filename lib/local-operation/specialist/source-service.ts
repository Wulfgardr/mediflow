import type Database from 'better-sqlite3';
import { z } from 'zod';
import { deny } from '../contract.ts';
import { specialistDecisionSchema, identitySchema } from './prescription.ts';

const patientSchema = z.object({ id: z.string(), first_name: z.string(), last_name: z.string(), tax_code: z.string(),
    version: z.number().int().positive(), created_at: z.number().int().nonnegative() });
const prescriptionSchema = z.object({ patient_id: z.string(), notes: z.string(), version: z.number().int().positive() });

export function readSpecialistSources(db: Database.Database, operationId: string, patientId: string, open: (value: string) => string) {
    const patient = patientSchema.parse(db.prepare('SELECT * FROM patients WHERE id=? AND deleted_at IS NULL AND COALESCE(is_archived,0)=0').get(patientId));
    const row = prescriptionSchema.parse(db.prepare("SELECT * FROM service_prescriptions WHERE id=? AND status='prescribed'").get(operationId));
    const payload = JSON.parse(open(row.notes));
    const decision = specialistDecisionSchema.parse({ ...payload.decision, version: String(row.version) });
    if (row.patient_id !== patient.id || decision.patientId !== patient.id) deny();
    const identityValue = (value: string) => value.startsWith('ENC:') ? open(value) : value;
    return { decision, identity: identitySchema.parse({ patientId: patient.id,
        name: `${identityValue(patient.first_name)} ${identityValue(patient.last_name)}`, identifier: identityValue(patient.tax_code),
        identifierType: 'synthetic', version: String(patient.version), verifiedAt: patient.created_at * 1000 }) };
}
