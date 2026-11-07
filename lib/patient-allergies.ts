import { z } from 'zod';

export const patientAllergySchema = z.object({
    substance: z.string().trim().min(1, 'Indica la sostanza.').max(200, 'Usa al massimo 200 caratteri.'),
    reaction: z.string().max(500, 'Usa al massimo 500 caratteri.').optional(),
    severity: z.enum(['mild', 'moderate', 'severe']).optional(),
}).strict();
export const patientAllergiesSchema = z.array(patientAllergySchema).max(100, 'Sono ammesse al massimo 100 allergie.');
export type PatientAllergy = z.infer<typeof patientAllergySchema>;

export const ALLERGY_SEVERITY_LABELS = { mild: 'Lieve', moderate: 'Moderata', severe: 'Grave' } as const;

export function patientAllergiesForHeader(value: unknown): { allergies?: string[]; allergiesUnavailable?: boolean } {
    if (value == null) return { allergies: [] };
    const parsed = patientAllergiesSchema.safeParse(value);
    return parsed.success ? { allergies: parsed.data.map(row => row.substance) } : { allergiesUnavailable: true };
}

export function isSealedPatientAllergies(value: unknown): value is string | null | undefined {
    return value === undefined || value === null
        || (typeof value === 'string' && /^ENC:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/.test(value));
}
