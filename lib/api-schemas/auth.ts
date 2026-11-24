import { identifierError } from '../patient-identity';
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
    doctorTaxCode: z.string().trim().transform(value => value.toUpperCase())
        .refine(value => !value || identifierError('cf', value) === null).nullable().optional(),
    verifier: z.string().optional(),
    recovery: z.object({ wrappedMasterKey: z.string(), salt: z.string(), verifier: z.string() }).optional(),
}).superRefine((value, context) => {
    const passphrase = value.encryptedMasterKey.startsWith('v3:') || value.verifier !== undefined || value.recovery !== undefined;
    if (passphrase && !validatePassphraseSetupCredentials(value)) {
        context.addIssue({ code: 'custom', path: ['encryptedMasterKey'], message: 'Materiale della passphrase o di recupero non valido.' });
    }
});

const conditionalProfileNameSchema = z.string().trim().max(200).nullable()
    .transform((value) => value === null || value.length === 0 ? null : value);

export const authProfileConditionalUpdateSchema = z.object({
    expectedVersion: z.string().min(1),
    displayName: conditionalProfileNameSchema,
    ambulatoryName: conditionalProfileNameSchema,
    doctorTaxCode: z.string().trim().transform(value => value.toUpperCase())
        .refine(value => !value || identifierError('cf', value) === null).nullable().optional(),
}).strict();

export type AuthSetupPayload = z.infer<typeof authSetupSchema>;
export type AuthProfileConditionalUpdatePayload = z.infer<typeof authProfileConditionalUpdateSchema>;

