// Codex: created 2026-02-01
import { NextResponse } from 'next/server';
/* @Codex */
import { getOrCreateLocalApiToken } from './local-api-token';

/* @Codex */
function extractProvidedLocalApiToken(request: Request): string | null {
    const authHeader = request.headers.get('authorization') ?? '';
    const legacyHeader = request.headers.get('x-mediflow-token') ?? '';
    const bearerPrefix = 'Bearer ';
    const token = authHeader.startsWith(bearerPrefix)
        ? authHeader.slice(bearerPrefix.length)
        : authHeader;

    if (token.trim().length > 0) return token;
    if (legacyHeader.trim().length > 0) return legacyHeader;
    return null;
}

/* @Codex */
export function hasValidLocalApiToken(request: Request): boolean {
    const expectedToken = getOrCreateLocalApiToken();
    const providedToken = extractProvidedLocalApiToken(request);
    return providedToken === expectedToken;
}

export function requireLocalApiToken(request: Request): NextResponse | null {
    /* @Codex */
    if (!hasValidLocalApiToken(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return null;
}
