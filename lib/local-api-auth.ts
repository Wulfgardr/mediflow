// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
/* @Codex */
import { getOrCreateLocalApiToken } from '@/lib/local-api-token';

export function requireLocalApiToken(request: Request): NextResponse | null {
    /* @Codex */
    const expectedToken = getOrCreateLocalApiToken();

    const authHeader = request.headers.get('authorization') ?? '';
    const legacyHeader = request.headers.get('x-mediflow-token') ?? '';
    const bearerPrefix = 'Bearer ';
    const token = authHeader.startsWith(bearerPrefix)
        ? authHeader.slice(bearerPrefix.length)
        : authHeader;

    if (token !== expectedToken && legacyHeader !== expectedToken) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return null;
}
