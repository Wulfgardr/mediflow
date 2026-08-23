import 'server-only';
import { randomBytes } from 'node:crypto';
import { types } from 'node:util';

/* @Codex */
export const INITIAL_DOCUMENT_CURRENTNESS = 1;

/* @Codex */
const DOCUMENT_SOURCE_REF_PATTERN = /^[0-9a-f]{64}$/u;

/* @Codex */
const INVALID_GENERATED_DOCUMENT_SOURCE_REF = 'Generated document source reference is invalid.';

/* @Codex */
export function createDocumentSourceRef(): string {
    return createDocumentSourceRefFromEntropyForTest(randomBytes(32));
}

/* @Codex */
export function createDocumentSourceRefFromEntropyForTest(entropy: unknown): string {
    let value: string;
    try {
        if (
            types.isProxy(entropy)
            || !Buffer.isBuffer(entropy)
            || Object.getOwnPropertyDescriptor(entropy, 'length') !== undefined
            || Object.getOwnPropertyDescriptor(entropy, 'toString') !== undefined
        ) {
            throw new Error(INVALID_GENERATED_DOCUMENT_SOURCE_REF);
        }
        value = Buffer.prototype.toString.call(entropy, 'hex');
    } catch {
        throw new Error(INVALID_GENERATED_DOCUMENT_SOURCE_REF);
    }

    if (!isDocumentSourceRef(value)) {
        throw new Error(INVALID_GENERATED_DOCUMENT_SOURCE_REF);
    }

    return value;
}

/* @Codex */
export function isDocumentSourceRef(value: unknown): value is string {
    return typeof value === 'string' && DOCUMENT_SOURCE_REF_PATTERN.test(value);
}
