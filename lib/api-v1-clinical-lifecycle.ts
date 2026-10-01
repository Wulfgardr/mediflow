// Ordinary Web/local-v1 checkup DELETE callers retain the optional-body contract.
import { readBoundedJsonBody } from './bounded-request-body';

export const LOCAL_CHECKUP_DELETE_JSON_MAX_BYTES = 4 * 1024 * 1024;

export type ClinicalDeleteBodyValues = {
    version: unknown;
    deletedAt: unknown;
    deletionReason: string;
};

export type ClinicalDeleteBodyResult =
    | { ok: true; values: ClinicalDeleteBodyValues }
    | { ok: false; error: string; status?: 413; code?: 'JSON_BODY_TOO_LARGE' };

function hasOwn(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

export async function parseClinicalDeleteBody(
    request: Request,
    defaultDeletionReason = 'api-v1-delete',
): Promise<ClinicalDeleteBodyResult> {
    let body: Record<string, unknown>;
    try {
        const parsed = await readBoundedJsonBody(request, LOCAL_CHECKUP_DELETE_JSON_MAX_BYTES,
            'request-json', { signal: request.signal, deadline: Infinity }, 'empty-object');
        if (!parsed.ok && parsed.status === 413) {
            return { ok: false, error: 'JSON payload too large', status: 413, code: 'JSON_BODY_TOO_LARGE' };
        }
        if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
            return { ok: false, error: 'Invalid JSON body' };
        }
        body = parsed.value as Record<string, unknown>;
    } catch {
        // A locked/unreadable stream can fail before the canonical reader's loop.
        return { ok: false, error: 'Invalid JSON body' };
    }

    if (hasOwn(body, 'deletedAt') && (body.deletedAt === null || body.deletedAt === '')) {
        return { ok: false, error: 'Invalid deletedAt' };
    }

    let deletionReason = defaultDeletionReason;
    if (hasOwn(body, 'deletionReason')) {
        if (typeof body.deletionReason !== 'string' || body.deletionReason.trim().length === 0) {
            return { ok: false, error: 'Invalid deletionReason' };
        }
        deletionReason = body.deletionReason.trim();
    }

    return {
        ok: true,
        values: {
            version: body.version,
            deletedAt: hasOwn(body, 'deletedAt') ? body.deletedAt : new Date(),
            deletionReason,
        },
    };
}
