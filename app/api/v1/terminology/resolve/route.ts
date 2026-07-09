/* @Codex */
import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { resolveTerminologyCatalog } from '@/lib/network-catalog-read';

/* @Codex */
export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const result = await resolveTerminologyCatalog(searchParams);
        return NextResponse.json(result.body, { status: result.status ?? 200 });
    } catch (error) {
        console.error('API GET /api/v1/terminology/resolve error:', error);
        return NextResponse.json({ error: 'Failed to resolve terminology code' }, { status: 500 });
    }
}
