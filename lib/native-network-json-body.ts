/* @Codex */
import { readBoundedJsonBody, type BoundedJsonReadControl } from './bounded-request-body';
import { resolveMaxAttachmentBytes } from './attachment-payload';

export const NATIVE_BOOTSTRAP_JSON_MAX_BYTES = 64 * 1024;
export const NETWORK_JSON_MAX_BYTES = 4 * 1024 * 1024;

/** Canonical client JSON keeps ENC ASCII unescaped; metadata shares the extra 4 MiB. */
export function networkAttachmentJsonMaxBytes(): number {
    const maximum = resolveMaxAttachmentBytes() + NETWORK_JSON_MAX_BYTES;
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
    control?: BoundedJsonReadControl,
): Promise<unknown> {
    const result = await readBoundedJsonBody(request, maximumBytes, 'request-json', control);
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

/* @Codex */
export const NETWORK_ATTACHMENT_MAX_IN_FLIGHT = 1;
export const NETWORK_ATTACHMENT_READ_TIMEOUT_MS = 30_000;
let attachmentOperations = 0;

/** After admission only. Own the reservation through parsing, service and response construction. */
export async function withNetworkAttachmentJson(
    request: Request,
    consume: (body: unknown) => Promise<Response>,
): Promise<Response> {
    if (attachmentOperations >= NETWORK_ATTACHMENT_MAX_IN_FLIGHT) {
        return Response.json({ error: 'Attachment operation busy', code: 'ATTACHMENT_OPERATION_BUSY' },
            { status: 503, headers: { 'Retry-After': '1' } });
    }
    attachmentOperations += 1;
    try {
        const controller = new AbortController();
        const abort = () => controller.abort();
        if (request.signal.aborted) abort();
        else request.signal.addEventListener('abort', abort, { once: true });
        const deadline = performance.now() + NETWORK_ATTACHMENT_READ_TIMEOUT_MS;
        const timer = setTimeout(abort, NETWORK_ATTACHMENT_READ_TIMEOUT_MS);
        let body: unknown;
        try {
            body = await readNativeNetworkJson(request, networkAttachmentJsonMaxBytes(), { signal: controller.signal, deadline });
        } catch (error) {
            if (error instanceof JsonBodyTooLargeError) throw error;
            if (!controller.signal.aborted && performance.now() < deadline) throw error;
            const aborted = request.signal.aborted;
            return Response.json({
                error: aborted ? 'Attachment body read aborted' : 'Attachment body read timeout',
                code: aborted ? 'ATTACHMENT_BODY_READ_ABORTED' : 'ATTACHMENT_BODY_READ_TIMEOUT',
            }, { status: aborted ? 400 : 408 });
        } finally {
            clearTimeout(timer);
            request.signal.removeEventListener('abort', abort);
        }
        // Await is essential: abort/timeout must never race a still-running service.
        return await consume(body);
    } finally {
        attachmentOperations -= 1;
    }
}
