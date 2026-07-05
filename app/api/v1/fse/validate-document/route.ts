/* @Codex */
import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { validateProfileDocument } from '@/lib/fse-validation';

/* @Codex */
function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/* @Codex */
export async function POST(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const body = await request.json();
        const profile = asNonEmptyString(body?.profile);
        const payload = body?.document ?? body?.payload ?? {};

        if (!profile) {
            return NextResponse.json({ error: 'profile is required' }, { status: 400 });
        }

        const result = await validateProfileDocument(profile, payload);
        if (result) {
            return NextResponse.json(result);
        }

        return NextResponse.json({ error: 'Unsupported profile' }, { status: 400 });
    } catch (error) {
        console.error('API POST /api/v1/fse/validate-document error:', error);
        return NextResponse.json({ error: 'Failed to validate profile document' }, { status: 500 });
    }
}
