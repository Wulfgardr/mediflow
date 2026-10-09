import { readBoundedJsonBody } from './bounded-request-body';

export const PRESCRIPTION_JSON_MAX_BYTES = 4 * 1024 * 1024;

type PrescriptionJsonObject = { ok: true; body: Record<string, unknown> }
    | { ok: false; response: Response };

/** After existing auth/admission only; field validation belongs to the route. */
export async function readPrescriptionJsonObject(request: Request, emptyBody: 'reject' | 'empty-object' = 'reject'): Promise<PrescriptionJsonObject> {
    let result;
    try {
        result = await readBoundedJsonBody(request, PRESCRIPTION_JSON_MAX_BYTES, 'request-json',
            { signal: request.signal, deadline: Infinity }, emptyBody);
    } catch {
        // A locked/unreadable body may fail before the canonical reader's read loop.
        return { ok: false, response: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) };
    }
    if (!result.ok && result.status === 413) {
        return { ok: false, response: Response.json(
            { error: 'JSON payload too large', code: 'JSON_BODY_TOO_LARGE' }, { status: 413 }) };
    }
    if (!result.ok || typeof result.value !== 'object' || result.value === null || Array.isArray(result.value)) {
        return { ok: false, response: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) };
    }
    return { ok: true, body: result.value as Record<string, unknown> };
}
