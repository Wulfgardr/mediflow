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

const outcomeSchema = z.enum(['started', 'completed', 'blocked', 'cancelled']);

export const sissHandoffCreateSchema = z.object({
    id: optionalIdSchema,
    patientId: requiredTextSchema,
    action: requiredTextSchema,
    moduleLabel: z.string().optional(),
    reason: optionalTextSchema,
    startedAt: dateInputSchema.optional(),
    completedAt: nullableDateInputSchema,
    outcome: outcomeSchema.optional(),
    nextAction: optionalTextSchema,
    notes: optionalTextSchema,
    correlationId: optionalTextSchema,
});

export const sissHandoffWritePreconditionSchema = z.object({
    patientId: requiredTextSchema,
    version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

export const sissHandoffUpdateSchema = sissHandoffWritePreconditionSchema.extend({
    action: requiredTextSchema.optional(),
    moduleLabel: requiredTextSchema.optional(),
    reason: optionalTextSchema,
    startedAt: optionalDateInputSchema,
    completedAt: nullableDateInputSchema,
    outcome: outcomeSchema.optional(),
    nextAction: optionalTextSchema,
    notes: optionalTextSchema,
    correlationId: optionalTextSchema,
});

export type SissHandoffCreatePayload = z.infer<typeof sissHandoffCreateSchema>;
export type SissHandoffUpdatePayload = z.infer<typeof sissHandoffUpdateSchema>;

