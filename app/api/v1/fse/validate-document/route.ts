/* @Codex */
import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
/* @Codex */
import { validateFseDocumentPayload } from '@/lib/fse-validate-document';

/* @Codex */
export async function POST(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const body = await request.json() as Record<string, unknown>;
        const result = await validateFseDocumentPayload(body);
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /api/v1/fse/validate-document error:', error);
        return NextResponse.json({ error: 'Failed to validate profile document' }, { status: 500 });
    }
}
