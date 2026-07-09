/* @Codex */
import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { listTerminologyCatalogSystems } from '@/lib/network-catalog-read';

/* @Codex */
export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    const result = await listTerminologyCatalogSystems();
    return NextResponse.json(result.body, { status: result.status ?? 200 });
}
