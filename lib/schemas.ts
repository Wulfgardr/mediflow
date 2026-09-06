import * as z from 'zod';
/* @Codex */
import { isWhoCanonicalMmsUri, parseWhoLocalReference, type WhoLocalReference } from './reference-data/icd11-who-local-contract';

export const diagnosisSchema = z.object({
    code: z.string().min(1, "Codice richiesto"),
    description: z.string().min(1, "Descrizione richiesta"),
    system: z.enum(['ICD-9', 'ICD-10', 'ICD-11']),
    date: z.string().or(z.date()).transform(d => new Date(d)),
    /* @Codex: preserve the selected WHO identity inside the existing encrypted JSON field. */
    canonicalUri: z.string().refine(isWhoCanonicalMmsUri, 'URI WHO non valido').optional(),
    reference: z.custom<WhoLocalReference>(value => parseWhoLocalReference(value) !== null, 'Riferimento WHO non valido').optional(),
}).superRefine((row, context) => {
    /* @Codex: never accept a half-linked or non-ICD-11 WHO selection. */
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
    taxCode: z.string().length(16, "Il codice fiscale deve essere di 16 caratteri").regex(/^[A-Z0-9]+$/i, "Formato non valido"),
    birthDate: z.string().optional().or(z.literal('')),
    address: z.string().optional(),
    phone: z.string().optional(),
    caregiver: z.string().optional(),
    /* @Codex */
    exemptions: z.array(z.string().min(1)).optional().default([]),
    notes: z.string().optional(),
    isAdi: z.boolean().default(false),
    monitoringProfile: z.enum(['taken_in_charge', 'extemporaneous']).default('taken_in_charge'),
    statusReason: z.string().optional(),
    diagnoses: z.array(diagnosisSchema).optional().default([]),
    checkups: z.array(checkupSchema).optional().default([])
});

export type PatientFormValues = z.infer<typeof patientSchema>;
