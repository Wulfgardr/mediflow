// WUL-308: shared DELETE-body parsing for the /api/v1 clinical sub-resources
// (entries/therapies/checkups/observations) so all four soft-delete uniformly.

export type ClinicalDeleteBodyValues = {
    version: unknown;
    deletedAt: unknown;
    deletionReason: string;
};

export type ClinicalDeleteBodyResult =
    | { ok: true; values: ClinicalDeleteBodyValues }
    | { ok: false; error: string };

function hasOwn(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}

export async function parseClinicalDeleteBody(request: Request): Promise<ClinicalDeleteBodyResult> {
    const text = await request.text();
    let body: Record<string, unknown> = {};
    if (text.trim().length > 0) {
        try {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return { ok: false, error: 'Invalid JSON body' };
            }
            body = parsed as Record<string, unknown>;
        } catch {
            return { ok: false, error: 'Invalid JSON body' };
        }
    }

    if (hasOwn(body, 'deletedAt') && (body.deletedAt === null || body.deletedAt === '')) {
        return { ok: false, error: 'Invalid deletedAt' };
    }

    let deletionReason = 'api-v1-delete';
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
