/* @Codex */
import 'server-only';

import { validateProfileDocument } from './fse-validation';

/* @Codex */
function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/* @Codex */
export async function validateFseDocumentPayload(
    body: unknown
): Promise<{ status: 200 | 400; value: Record<string, unknown> }> {
    const candidate = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const profile = asNonEmptyString(candidate.profile);
    const payload = candidate.document ?? candidate.payload ?? {};

    if (!profile) {
        return { status: 400, value: { error: 'profile is required' } };
    }

    const result = await validateProfileDocument(profile, payload);
    if (result) {
        return { status: 200, value: result };
    }

    return { status: 400, value: { error: 'Unsupported profile' } };
}
