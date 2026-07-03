/* @Codex */
import { z } from 'zod';
import { optionalTextSchema, requiredTextSchema } from './common';

export const authSetupSchema = z.object({
    username: requiredTextSchema,
    password: requiredTextSchema,
    encryptedMasterKey: requiredTextSchema,
    salt: requiredTextSchema,
    displayName: optionalTextSchema,
    ambulatoryName: optionalTextSchema,
});

export const authProfileUpdateSchema = z.object({
    id: z.string().optional(),
    displayName: optionalTextSchema,
    ambulatoryName: optionalTextSchema,
});

export type AuthSetupPayload = z.infer<typeof authSetupSchema>;
export type AuthProfileUpdatePayload = z.infer<typeof authProfileUpdateSchema>;

