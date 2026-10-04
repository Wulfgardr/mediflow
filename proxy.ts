/* @Codex */
import { NextResponse, type NextRequest } from 'next/server';

import { isTrustedWebMutationRequest } from '@/lib/security/request-transport';

const WEB_SESSION_COOKIE = 'mediflow_session';
const WEB_CONTROL_COOKIE = 'mediflow_auth_control';

function isMutationMethod(method: string): boolean {
    return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function hasWebAuthorityCookies(request: NextRequest): boolean {
    return request.cookies.has(WEB_SESSION_COOKIE) && request.cookies.has(WEB_CONTROL_COOKIE);
}

function hasAcceptedMutationContentType(request: Request): boolean {
    const value = request.headers.get('content-type');
    if (!value) return true;
    const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
    return mediaType === 'application/json'
        || mediaType === 'multipart/form-data'
        || mediaType === 'application/octet-stream';
}

function denied(): NextResponse {
    const response = NextResponse.json({
        error: 'Request transport unavailable',
        code: 'request_transport_invalid',
    }, { status: 403 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

/** Enforces the Web cookie transport once, before any API route can read a mutation body. */
export function proxy(request: NextRequest): NextResponse {
    if (!isMutationMethod(request.method) || !hasWebAuthorityCookies(request)) {
        return NextResponse.next();
    }
    if (!isTrustedWebMutationRequest(request, false) || !hasAcceptedMutationContentType(request)) {
        return denied();
    }
    return NextResponse.next();
}

export const config = {
    matcher: ['/api/:path*'],
};
