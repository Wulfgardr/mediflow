import 'server-only';
import { randomBytes } from 'node:crypto';

/* @Codex */
export const INITIAL_DOCUMENT_CURRENTNESS = 1;

/* @Codex */
const DOCUMENT_SOURCE_REF_PATTERN = /^[0-9a-f]{64}$/u;

/* @Codex */
export function createDocumentSourceRef(): string {
    return randomBytes(32).toString('hex');
}

/* @Codex */
export function isDocumentSourceRef(value: unknown): value is string {
    return typeof value === 'string' && DOCUMENT_SOURCE_REF_PATTERN.test(value);
}
