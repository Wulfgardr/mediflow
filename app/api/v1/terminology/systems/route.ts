/* @Codex */
import { NextResponse } from 'next/server';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { loadTerminologyRegistry } from '@/lib/terminology-registry';

/* @Codex */
export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    return NextResponse.json(await loadTerminologyRegistry());
}
