// Codex: created 2026-02-01
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
/* @Codex */
import { getOrCreateLocalApiToken } from './local-api-token';

/* @Codex */
function extractProvidedLocalApiToken(request: Request): string | null {
    const authHeader = request.headers.get('authorization') ?? '';
    const legacyHeader = request.headers.get('x-mediflow-token') ?? '';
    const bearerPrefix = 'Bearer ';
    const bearerToken = authHeader.startsWith(bearerPrefix)
        ? authHeader.slice(bearerPrefix.length).trim()
        : '';
    const legacyToken = legacyHeader.trim();

    if (bearerToken.length > 0) return bearerToken;
    if (legacyToken.length > 0) return legacyToken;
    return null;
}

function hashTokenForComparison(token: string): Buffer {
    return createHash('sha256').update(token).digest();
}

function hasSameTokenValue(providedToken: string, expectedToken: string): boolean {
    return timingSafeEqual(
        hashTokenForComparison(providedToken),
        hashTokenForComparison(expectedToken),
    );
}

/* @Codex */
export function hasValidLocalApiToken(request: Request): boolean {
    const expectedToken = getOrCreateLocalApiToken();
    const providedToken = extractProvidedLocalApiToken(request);
    if (providedToken === null) return false;
    return hasSameTokenValue(providedToken, expectedToken);
}

export function requireLocalApiToken(request: Request): NextResponse | null {
    /* @Codex */
    if (!hasValidLocalApiToken(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return null;
}
