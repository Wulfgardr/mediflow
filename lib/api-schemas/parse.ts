import type { z } from 'zod';

export const INVALID_API_PAYLOAD_ERROR = 'Payload non valido';

export type ParsedApiBody<T> =
    | { ok: true; data: T }
    | { ok: false; response: Response };

export function parseApiBody<T>(
    schema: z.ZodType<T>,
    body: unknown,
    errorMessage = INVALID_API_PAYLOAD_ERROR,
): ParsedApiBody<T> {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        return {
            ok: false,
            response: Response.json({ error: errorMessage }, { status: 400 }),
        };
    }

    return { ok: true, data: parsed.data };
}
