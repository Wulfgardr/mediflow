/* @Codex */
import { z } from 'zod';

export const optionalIdSchema = z.string().optional();

export const requiredTextSchema = z.string().refine((value) => value.trim().length > 0);

export const optionalTextSchema = z.union([z.string(), z.null()]).optional();

export const optionalBooleanSchema = z.boolean().optional();

export const dateInputSchema = z
    .union([z.string(), z.number(), z.date()])
    .refine((value) => {
        if (typeof value === 'string' && value.trim().length === 0) return false;
        const parsed = value instanceof Date ? value : new Date(value);
        return !Number.isNaN(parsed.getTime());
    });

export const optionalDateInputSchema = dateInputSchema.optional();

export const nullableDateInputSchema = z.union([dateInputSchema, z.null(), z.literal('')]).optional();

export const optionalIntegerInputSchema = z
    .union([
        z.number().finite(),
        z.string().refine((value) => value.trim().length > 0 && Number.isFinite(Number.parseInt(value, 10))),
    ])
    .optional();

