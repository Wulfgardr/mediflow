/* @Codex */
export type SessionCookieOptions = {
    httpOnly: true;
    sameSite: 'lax';
    secure: boolean;
    path: '/';
};

const HTTPS_PROTOCOL = 'https:';

/* @Codex */
function forwardedProtoValues(request: Request): string[] {
    const forwardedProto = request.headers.get('x-forwarded-proto');
    if (!forwardedProto) return [];

    return forwardedProto
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
}

/* @Codex */
export function isHttpsRequest(request: Request): boolean {
    if (new URL(request.url).protocol === HTTPS_PROTOCOL) {
        return true;
    }

    return forwardedProtoValues(request).includes('https');
}

/* @Codex */
export function sessionCookieOptionsForRequest(request: Request): SessionCookieOptions {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttpsRequest(request),
        path: '/',
    };
}
