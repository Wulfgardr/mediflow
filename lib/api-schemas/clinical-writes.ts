/* @Codex */
import { z } from 'zod';
import {
    dateInputSchema,
    nullableDateInputSchema,
    optionalDateInputSchema,
    optionalIdSchema,
    optionalTextSchema,
    requiredTextSchema,
} from './common';

export const checkupCreateSchema = z.object({
    id: optionalIdSchema,
    patientId: requiredTextSchema,
    date: dateInputSchema,
    title: requiredTextSchema,
    notes: optionalTextSchema,
    status: z.string().optional(),
    source: z.string().optional(),
});

export const therapyCreateSchema = z.object({
    id: optionalIdSchema,
    patientId: requiredTextSchema,
    drugName: requiredTextSchema,
    aic: optionalTextSchema,
    atc: optionalTextSchema,
    activePrinciple: optionalTextSchema,
    dosage: requiredTextSchema,
    motivation: optionalTextSchema,
    diagnosisCode: optionalTextSchema,
    diagnosisName: optionalTextSchema,
    status: z.string().optional(),
    startDate: dateInputSchema,
    endDate: nullableDateInputSchema,
});

export const therapyUpdateSchema = z.object({
    drugName: requiredTextSchema.optional(),
    aic: optionalTextSchema,
    atc: optionalTextSchema,
    activePrinciple: optionalTextSchema,
    dosage: requiredTextSchema.optional(),
    motivation: optionalTextSchema,
    diagnosisCode: optionalTextSchema,
    diagnosisName: optionalTextSchema,
    status: z.string().optional(),
    startDate: optionalDateInputSchema,
    endDate: nullableDateInputSchema,
});

export type CheckupCreatePayload = z.infer<typeof checkupCreateSchema>;
export type TherapyCreatePayload = z.infer<typeof therapyCreateSchema>;
export type TherapyUpdatePayload = z.infer<typeof therapyUpdateSchema>;

