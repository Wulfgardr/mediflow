/* @Codex */
import { z } from 'zod';

const idSchema = z.string().trim().min(1);
const patientIdsSchema = z.array(idSchema).min(1).transform((ids) => Array.from(new Set(ids)));
const patientVersionsSchema = z.record(z.string(), z.number().int().positive());

const targetAmbulatorySchema = z.object({
    patientIds: patientIdsSchema,
    targetAmbulatoryId: idSchema,
});

export const patientAssignSchema = targetAmbulatorySchema;
export const patientDuplicateSchema = targetAmbulatorySchema;

export const patientUnassignSchema = z.object({
    patientIds: patientIdsSchema,
    ambulatoryId: idSchema,
});

export const patientMoveSchema = targetAmbulatorySchema.extend({
    sourceAmbulatoryId: idSchema.nullish().transform((value) => value ?? undefined),
    patientVersions: patientVersionsSchema,
}).superRefine((value, context) => {
    const requestedIds = new Set(value.patientIds);
    for (const patientId of requestedIds) {
        if (!Object.hasOwn(value.patientVersions, patientId)) {
            context.addIssue({
                code: 'custom',
                path: ['patientVersions', patientId],
                message: 'Missing patient version',
            });
        }
    }
    for (const patientId of Object.keys(value.patientVersions)) {
        if (!requestedIds.has(patientId)) {
            context.addIssue({
                code: 'custom',
                path: ['patientVersions', patientId],
                message: 'Unexpected patient version',
            });
        }
    }
});
