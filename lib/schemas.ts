import { IDENTIFIER_TYPES, birthError, identifierError, inferIdentifierType } from './patient-identity';
import { parseWhoReference, type WhoReference } from './reference-data/icd11-reference';
import * as z from 'zod';
import { isWhoCanonicalMmsUri } from './reference-data/icd11-who-local-contract';

export const diagnosisSchema = z.object({
    code: z.string().min(1, "Codice richiesto"),
    description: z.string().min(1, "Descrizione richiesta"),
    system: z.enum(['ICD-9', 'ICD-10', 'ICD-11']),
    date: z.string().or(z.date()).transform(d => new Date(d)),
    /* preserve the selected WHO identity inside the existing encrypted JSON field. */
    canonicalUri: z.string().refine(isWhoCanonicalMmsUri, 'URI WHO non valido').optional(),
    reference: z.custom<WhoReference>(value => parseWhoReference(value) !== null, 'Riferimento WHO non valido').optional(),
}).superRefine((row, context) => {
    /* never accept a half-linked or non-ICD-11 WHO selection. */
    if ((row.canonicalUri !== undefined) !== (row.reference !== undefined)
        || (row.canonicalUri !== undefined && row.system !== 'ICD-11')) {
        context.addIssue({ code: 'custom', path: ['canonicalUri'], message: 'Selezione WHO incompleta: ripetere la ricerca.' });
    }
});

export const checkupSchema = z.object({
    id: z.string().optional(), // Optional for new ones
    date: z.string().or(z.date()).transform(d => new Date(d)),
    title: z.string().min(1, "Titolo richiesto"),
    notes: z.string().optional(),
    status: z.enum(['pending', 'completed', 'cancelled']).default('pending'),
    source: z.enum(['manual', 'ai_suggestion']).default('manual'),
});

export const patientSchema = z.object({
    firstName: z.string().min(2, "Il nome è troppo corto"),
    lastName: z.string().min(2, "Il cognome è troppo corto"),
    taxCode: z.string().default(''),
    identifierType: z.enum(IDENTIFIER_TYPES).optional(),
    birthDatePrecision: z.enum(['exact', 'estimated', 'unknown']).optional(),
    birthYear: z.number().int().nullable().optional(),
    birthDate: z.string().optional().or(z.literal('')),
    address: z.string().optional(),
    phone: z.string().optional(),
    caregiver: z.string().optional(),
    exemptions: z.array(z.string().min(1)).optional().default([]),
    notes: z.string().optional(),
    isAdi: z.boolean().default(false),
    monitoringProfile: z.enum(['taken_in_charge', 'extemporaneous']).default('taken_in_charge'),
    statusReason: z.string().optional(),
    diagnoses: z.array(diagnosisSchema).optional().default([]),
    checkups: z.array(checkupSchema).optional().default([])
}).superRefine((value, context) => {
    const error = identifierError(value.identifierType ?? inferIdentifierType(value.taxCode), value.taxCode);
    if (error) context.addIssue({ code: 'custom', path: ['taxCode'], message: error });
    const birth = birthError(value);
    if (birth) context.addIssue({ code: 'custom', path: [value.birthDatePrecision === 'estimated' ? 'birthYear' : 'birthDate'], message: birth });
});

export type PatientFormValues = z.infer<typeof patientSchema>;
