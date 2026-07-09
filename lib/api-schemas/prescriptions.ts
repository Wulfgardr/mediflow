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
/* @Codex */
import {
    PROSTHETIC_PRESCRIPTION_CATEGORIES,
    PROSTHETIC_PRESCRIPTION_SOURCES,
    PROSTHETIC_PRESCRIPTION_STATUSES,
    SERVICE_PRESCRIPTION_CATEGORIES,
    SERVICE_PRESCRIPTION_ITEM_CONFIDENCES,
    SERVICE_PRESCRIPTION_ITEM_MATCH_STATUSES,
    SERVICE_PRESCRIPTION_PRIORITIES,
    SERVICE_PRESCRIPTION_SOURCES,
    SERVICE_PRESCRIPTION_STATUSES,
} from '../prescription-domain';

const prostheticStatusSchema = z.enum(PROSTHETIC_PRESCRIPTION_STATUSES);
const prostheticCategorySchema = z.enum(PROSTHETIC_PRESCRIPTION_CATEGORIES);
const prostheticSourceSchema = z.enum(PROSTHETIC_PRESCRIPTION_SOURCES);

const serviceStatusSchema = z.enum(SERVICE_PRESCRIPTION_STATUSES);
const serviceCategorySchema = z.enum(SERVICE_PRESCRIPTION_CATEGORIES);
const servicePrioritySchema = z.enum(SERVICE_PRESCRIPTION_PRIORITIES);
const serviceSourceSchema = z.enum(SERVICE_PRESCRIPTION_SOURCES);
const serviceMatchStatusSchema = z.enum(SERVICE_PRESCRIPTION_ITEM_MATCH_STATUSES);
const serviceConfidenceSchema = z.enum(SERVICE_PRESCRIPTION_ITEM_CONFIDENCES);

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
    /* @Codex */
    version: z.number().int().positive(),
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
    /* @Codex */
    version: z.number().int().positive(),
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
    /* @Codex */
    version: z.number().int().positive(),
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
