/* @Codex: WUL-720 patient PUT envelope only; field validation remains with existing normalizers. */
export async function parsePatientJsonObject(read: () => Promise<unknown>): Promise<
    | { ok: true; body: Record<string, unknown> }
    | { ok: false }
> {
    let value: unknown;
    try {
        value = await read();
    } catch (error) {
        if (error instanceof SyntaxError) return { ok: false };
        throw error;
    }

    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? { ok: true, body: value as Record<string, unknown> }
        : { ok: false };
}

/* @Codex: WUL-720 patient-only bounded transport, after existing admission gates. */
import { readBoundedJsonBody } from './bounded-request-body';
export const PATIENT_JSON_MAX_BYTES = 4_194_304;

export async function readPatientJsonObject(request: Request) {
    const parsed = await readBoundedJsonBody(request, PATIENT_JSON_MAX_BYTES, 'request-json',
        { signal: request.signal, deadline: Infinity });
    if (!parsed.ok) return parsed.status === 413
        ? { ok: false as const, status: 413 as const, error: 'JSON payload too large', code: 'JSON_BODY_TOO_LARGE' }
        : { ok: false as const, status: 400 as const, error: 'Richiesta non valida.' };
    const object = await parsePatientJsonObject(async () => parsed.value);
    return object.ok ? object : { ok: false as const, status: 400 as const, error: 'Richiesta non valida.' };
}
