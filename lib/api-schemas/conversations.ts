/* @Codex */
import { z } from 'zod';
import { optionalBooleanSchema, optionalIdSchema, requiredTextSchema } from './common';

export const conversationCreateSchema = z.object({
    id: optionalIdSchema,
    title: requiredTextSchema,
});

export const conversationUpdateSchema = z.object({
    title: requiredTextSchema.optional(),
    isArchived: optionalBooleanSchema,
    isDeleted: optionalBooleanSchema,
});

export type ConversationCreatePayload = z.infer<typeof conversationCreateSchema>;
export type ConversationUpdatePayload = z.infer<typeof conversationUpdateSchema>;

