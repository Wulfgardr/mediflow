/* @Codex */
import { readBoundedJsonBody } from './bounded-request-body';
import { resolveMaxAttachmentBytes } from './attachment-payload';

export const NATIVE_BOOTSTRAP_JSON_MAX_BYTES = 64 * 1024;
export const NETWORK_JSON_MAX_BYTES = 4 * 1024 * 1024;

/** Preserve the ciphertext budget even when every ASCII byte is JSON escaped. */
export function networkAttachmentJsonMaxBytes(): number {
    const maximum = 6 * resolveMaxAttachmentBytes() + NETWORK_JSON_MAX_BYTES;
    if (!Number.isSafeInteger(maximum)) throw new RangeError('Invalid attachment JSON byte budget');
    return maximum;
}

export class JsonBodyTooLargeError extends Error {
    constructor() {
        super('JSON payload too large');
        this.name = 'JsonBodyTooLargeError';
    }
}

export function jsonBodyTooLargeResponse(error: unknown): Response | null {
    return error instanceof JsonBodyTooLargeError
        ? Response.json({ error: 'JSON payload too large', code: 'JSON_BODY_TOO_LARGE' }, { status: 413 })
        : null;
}

/** Call only after the route's existing admission/auth gates. */
export async function readNativeNetworkJson(
    request: Request,
    maximumBytes: number = NETWORK_JSON_MAX_BYTES,
): Promise<unknown> {
    const result = await readBoundedJsonBody(request, maximumBytes, 'request-json');
    if (result.ok) return result.value;
    if (result.status === 413) throw new JsonBodyTooLargeError();
    // Preserve each route's existing malformed-body path, including native login.
    throw new SyntaxError('Invalid JSON body');
}

/** The existing ambulatory DELETE accepts missing/malformed JSON, but not oversize. */
export function emptyJsonUnlessTooLarge(error: unknown): Record<string, never> {
    if (error instanceof JsonBodyTooLargeError) throw error;
    return {};
}
