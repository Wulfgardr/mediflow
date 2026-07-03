/* @Codex */
import { z } from 'zod';
import {
    optionalIdSchema,
    optionalTextSchema,
    requiredTextSchema,
} from './common';
import {
    DOCUMENT_OCR_QUEUE_REASONS,
    DOCUMENT_OCR_QUEUE_STATES,
} from '../document-ocr-queue';

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
});

export const attachmentUpdateSchema = z.object({
    summarySnapshot: optionalTextSchema,
    parseEvidenceArtifactSnapshot: optionalTextSchema,
    ocrQueueState: ocrQueueStateSchema,
});

export const attachmentOcrReplaySchema = z.object({
    ocrText: z.string(),
    documentSha256: requiredTextSchema,
});

export type AttachmentCreatePayload = z.infer<typeof attachmentCreateSchema>;
export type AttachmentUpdatePayload = z.infer<typeof attachmentUpdateSchema>;
export type AttachmentOcrReplayPayload = z.infer<typeof attachmentOcrReplaySchema>;
