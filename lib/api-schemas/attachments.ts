/* @Codex */
import { z } from 'zod';
import { types } from 'node:util';
import {
    optionalIdSchema,
    optionalTextSchema,
    requiredTextSchema,
} from './common';
import {
    DOCUMENT_OCR_QUEUE_REASONS,
    DOCUMENT_OCR_QUEUE_STATES,
} from '../domain/documents/document-ocr-queue';

const ocrQueueStateSchema = z.enum(DOCUMENT_OCR_QUEUE_STATES).optional();
const ocrQueueReasonSchema = z.enum(DOCUMENT_OCR_QUEUE_REASONS).optional();

export const attachmentCreateSchema = z.object({
    id: optionalIdSchema,
    patientId: requiredTextSchema,
    name: requiredTextSchema,
    type: requiredTextSchema,
    size: z.number().finite().nonnegative(),
    path: z.string().optional(),
    data: optionalTextSchema,
    summarySnapshot: optionalTextSchema,
    parseEvidenceArtifactSnapshot: optionalTextSchema,
    ocrQueueState: ocrQueueStateSchema,
    ocrQueueReason: ocrQueueReasonSchema,
}).strict();

export const attachmentUpdateSchema = z.object({
    summarySnapshot: optionalTextSchema,
    parseEvidenceArtifactSnapshot: optionalTextSchema,
    ocrQueueState: ocrQueueStateSchema,
});

/* @Codex: capture the parser's mutable intrinsics before request-side poisoning. */
const OBJECT_PROTOTYPE = Object.prototype;
const objectCreate = Object.create;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const objectFreeze = Object.freeze;
const reflectOwnKeys = Reflect.ownKeys;
const arrayIsArray = Array.isArray;
const numberIsSafeInteger = Number.isSafeInteger;
const regexpTest = Function.call.bind(RegExp.prototype.test) as (expression: RegExp, value: string) => boolean;
const isProxy = types.isProxy;
const SOURCE_REF = /^[0-9a-f]{64}$/u;
const SEALED_ATTACHMENT = /^ENC:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/u;
const ROOT_KEYS = ['expected', 'replacement'] as const;
const EXPECTED_KEYS = ['sourceRef', 'revision', 'freshnessEpoch'] as const;

export type AttachmentContentCurrentnessPutPayload = Readonly<{
    expected: Readonly<{ sourceRef: string; revision: number; freshnessEpoch: number }>;
    replacement: string;
}>;

function exactOwnDataFields(value: unknown, keys: readonly string[]): Record<string, PropertyDescriptor> | null {
    try {
        if (!value || typeof value !== 'object' || arrayIsArray(value) || isProxy(value)
            || objectGetPrototypeOf(value) !== OBJECT_PROTOTYPE
            || objectGetOwnPropertyDescriptor(OBJECT_PROTOTYPE, 'then') !== undefined
            || reflectOwnKeys(value).length !== keys.length) return null;
        const fields = objectCreate(null) as Record<string, PropertyDescriptor>;
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index]!;
            const descriptor = objectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !objectHasOwn(descriptor, 'value') || !objectHasOwn(descriptor, 'enumerable') || descriptor.enumerable !== true) return null;
            fields[key] = descriptor;
        }
        return fields;
    } catch {
        return null;
    }
}

/** Strict, descriptor-first data-only schema for the public attachment CAS route. */
export function parseAttachmentContentCurrentnessPut(value: unknown): AttachmentContentCurrentnessPutPayload | null {
    const root = exactOwnDataFields(value, ROOT_KEYS);
    if (!root) return null;
    const expected = exactOwnDataFields(root.expected!.value, EXPECTED_KEYS);
    if (!expected) return null;
    const sourceRef = expected.sourceRef!.value;
    const revision = expected.revision!.value;
    const freshnessEpoch = expected.freshnessEpoch!.value;
    const replacement = root.replacement!.value;
    if (typeof sourceRef !== 'string' || !regexpTest(SOURCE_REF, sourceRef)
        || typeof revision !== 'number' || !numberIsSafeInteger(revision) || revision < 1
        || typeof freshnessEpoch !== 'number' || !numberIsSafeInteger(freshnessEpoch) || freshnessEpoch < 1
        || typeof replacement !== 'string' || replacement.length === 0 || !regexpTest(SEALED_ATTACHMENT, replacement)) return null;
    return objectFreeze({
        expected: objectFreeze({ sourceRef, revision, freshnessEpoch }),
        replacement,
    });
}

export const attachmentOcrReplaySchema = z.object({
    ocrText: z.string(),
    documentSha256: requiredTextSchema,
});

export type AttachmentCreatePayload = z.infer<typeof attachmentCreateSchema>;
export type AttachmentUpdatePayload = z.infer<typeof attachmentUpdateSchema>;
export type AttachmentOcrReplayPayload = z.infer<typeof attachmentOcrReplaySchema>;
