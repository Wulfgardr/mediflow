/* @Codex */
import { z } from 'zod';
import { optionalTextSchema, requiredTextSchema } from './common';
import { validatePassphraseSetupCredentials } from '@/lib/security/passphrase-adoption-validation';

export const authSetupSchema = z.object({
    username: requiredTextSchema,
    password: requiredTextSchema,
    encryptedMasterKey: requiredTextSchema,
    salt: requiredTextSchema,
    displayName: optionalTextSchema,
    ambulatoryName: optionalTextSchema,
    verifier: z.string().optional(),
    recovery: z.object({ wrappedMasterKey: z.string(), salt: z.string(), verifier: z.string() }).optional(),
}).superRefine((value, context) => {
    const passphrase = value.encryptedMasterKey.startsWith('v3:') || value.verifier !== undefined || value.recovery !== undefined;
    if (passphrase && !validatePassphraseSetupCredentials(value)) {
        context.addIssue({ code: 'custom', path: ['encryptedMasterKey'], message: 'Materiale della passphrase o di recupero non valido.' });
    }
});

export const authProfileUpdateSchema = z.object({
    id: z.string().optional(),
    displayName: optionalTextSchema,
    ambulatoryName: optionalTextSchema,
});

export type AuthSetupPayload = z.infer<typeof authSetupSchema>;
export type AuthProfileUpdatePayload = z.infer<typeof authProfileUpdateSchema>;

