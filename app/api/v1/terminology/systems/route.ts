/* @Codex */
import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import { listTerminologySystems } from '@/lib/terminology';

/* @Codex */
export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    return NextResponse.json(listTerminologySystems());
}
