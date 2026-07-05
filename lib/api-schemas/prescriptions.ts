/* @Codex */
import { z } from 'zod';
import {
    dateInputSchema,
    nullableDateInputSchema,
    optionalDateInputSchema,
    optionalIdSchema,
    optionalIntegerInputSchema,
    optionalTextSchema,
    requiredTextSchema,
} from './common';

const prostheticStatusSchema = z.enum(['draft', 'prescribed', 'submitted', 'authorized', 'delivered', 'tested', 'cancelled']);
const prostheticCategorySchema = z.enum(['standard', 'oxygen', 'repair', 'replacement', 'trial', 'other']);
const prostheticSourceSchema = z.enum(['manual', 'document_review']);

const serviceStatusSchema = z.enum(['prescribed', 'booked', 'performed', 'report_received', 'cancelled']);
const serviceCategorySchema = z.enum(['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other']);
const servicePrioritySchema = z.enum(['U', 'B', 'D', 'P', 'routine', 'unknown']);
const serviceSourceSchema = z.enum(['manual', 'document_review', 'legacy_therapy_cleanup']);
const serviceMatchStatusSchema = z.enum(['unmatched', 'candidate', 'matched', 'manual', 'not_found']);
const serviceConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const prostheticPrescriptionCreateSchema = z.object({
    id: optionalIdSchema,
    patientId: requiredTextSchema,
    prescribedAt: dateInputSchema,
    status: prostheticStatusSchema.optional(),
    category: prostheticCategorySchema.optional(),
    isoCode: optionalTextSchema,
    description: requiredTextSchema,
    measures: optionalTextSchema,
    clinicalReason: optionalTextSchema,
    regionalPrescriptionId: optionalTextSchema,
    supplier: optionalTextSchema,
    collaudoAt: nullableDateInputSchema,
    collaudoOutcome: optionalTextSchema,
    source: prostheticSourceSchema.optional(),
    documentRefs: optionalTextSchema,
    notes: optionalTextSchema,
});

export const prostheticPrescriptionUpdateSchema = z.object({
    prescribedAt: optionalDateInputSchema,
    status: prostheticStatusSchema.optional(),
    category: prostheticCategorySchema.optional(),
    isoCode: optionalTextSchema,
    description: requiredTextSchema.optional(),
    measures: optionalTextSchema,
    clinicalReason: optionalTextSchema,
    regionalPrescriptionId: optionalTextSchema,
    supplier: optionalTextSchema,
    collaudoAt: nullableDateInputSchema,
    collaudoOutcome: optionalTextSchema,
    source: prostheticSourceSchema.optional(),
    documentRefs: optionalTextSchema,
    notes: optionalTextSchema,
});

export const servicePrescriptionCreateSchema = z.object({
    id: optionalIdSchema,
    patientId: requiredTextSchema,
    prescribedAt: dateInputSchema,
    status: serviceStatusSchema.optional(),
    category: serviceCategorySchema.optional(),
    priority: servicePrioritySchema.optional(),
    codeSystem: optionalTextSchema,
    serviceCode: optionalTextSchema,
    serviceName: requiredTextSchema,
    clinicalQuestion: optionalTextSchema,
    provider: optionalTextSchema,
    scheduledAt: nullableDateInputSchema,
    performedAt: nullableDateInputSchema,
    reportReceivedAt: nullableDateInputSchema,
    outcomeNote: optionalTextSchema,
    requestReference: optionalTextSchema,
    source: serviceSourceSchema.optional(),
    documentRefs: optionalTextSchema,
    notes: optionalTextSchema,
});

export const servicePrescriptionUpdateSchema = z.object({
    prescribedAt: optionalDateInputSchema,
    status: serviceStatusSchema.optional(),
    category: serviceCategorySchema.optional(),
    priority: servicePrioritySchema.nullable().optional(),
    codeSystem: optionalTextSchema,
    serviceCode: optionalTextSchema,
    serviceName: requiredTextSchema.optional(),
    clinicalQuestion: optionalTextSchema,
    provider: optionalTextSchema,
    scheduledAt: nullableDateInputSchema,
    performedAt: nullableDateInputSchema,
    reportReceivedAt: nullableDateInputSchema,
    outcomeNote: optionalTextSchema,
    requestReference: optionalTextSchema,
    source: serviceSourceSchema.optional(),
    documentRefs: optionalTextSchema,
    notes: optionalTextSchema,
});

export const servicePrescriptionItemCreateSchema = z.object({
    id: optionalIdSchema,
    prescriptionId: requiredTextSchema,
    ordinal: optionalIntegerInputSchema,
    status: serviceStatusSchema.optional(),
    category: serviceCategorySchema.nullable().optional(),
    codeSystem: optionalTextSchema,
    serviceCode: optionalTextSchema,
    serviceName: requiredTextSchema,
    catalogEntryId: optionalTextSchema,
    catalogDisplayName: optionalTextSchema,
    matchStatus: serviceMatchStatusSchema.optional(),
    confidence: serviceConfidenceSchema.nullable().optional(),
    evidence: optionalTextSchema,
    notes: optionalTextSchema,
    scheduledAt: nullableDateInputSchema,
    performedAt: nullableDateInputSchema,
    reportReceivedAt: nullableDateInputSchema,
    outcomeNote: optionalTextSchema,
});

export const servicePrescriptionItemUpdateSchema = z.object({
    ordinal: optionalIntegerInputSchema,
    status: serviceStatusSchema.optional(),
    category: serviceCategorySchema.nullable().optional(),
    codeSystem: optionalTextSchema,
    serviceCode: optionalTextSchema,
    serviceName: requiredTextSchema.optional(),
    catalogEntryId: optionalTextSchema,
    catalogDisplayName: optionalTextSchema,
    matchStatus: serviceMatchStatusSchema.optional(),
    confidence: serviceConfidenceSchema.nullable().optional(),
    evidence: optionalTextSchema,
    notes: optionalTextSchema,
    scheduledAt: nullableDateInputSchema,
    performedAt: nullableDateInputSchema,
    reportReceivedAt: nullableDateInputSchema,
    outcomeNote: optionalTextSchema,
});

export type ProstheticPrescriptionCreatePayload = z.infer<typeof prostheticPrescriptionCreateSchema>;
export type ProstheticPrescriptionUpdatePayload = z.infer<typeof prostheticPrescriptionUpdateSchema>;
export type ServicePrescriptionCreatePayload = z.infer<typeof servicePrescriptionCreateSchema>;
export type ServicePrescriptionUpdatePayload = z.infer<typeof servicePrescriptionUpdateSchema>;
export type ServicePrescriptionItemCreatePayload = z.infer<typeof servicePrescriptionItemCreateSchema>;
export type ServicePrescriptionItemUpdatePayload = z.infer<typeof servicePrescriptionItemUpdateSchema>;

