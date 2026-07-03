/* @Codex */
export type SessionCookieOptions = {
    httpOnly: true;
    sameSite: 'lax';
    secure: boolean;
    path: '/';
};

const HTTPS_PROTOCOL = 'https:';

// The local TLS proxy (scripts/local-api-tls-proxy.mjs) terminates TLS for LAN
// paired clients and forwards plaintext to the loopback-only Next server. It is
// the ONLY forwarder allowed to assert a secure transport on our behalf, and it
// stamps every proxied request with this internal marker. x-forwarded-proto is
// client-spoofable, so we never trust it on its own.
const TLS_PROXY_MARKER_HEADER = 'x-mediflow-tls-proxy';
const TLS_PROXY_MARKER_VALUE = 'local-api';

// D1 (WAVE 2 security hardening): the plaintext Next server binds loopback only;
// the proxy's HTTP target is validated as loopback in the proxy itself. So a
// request whose own URL is loopback and that carries the proxy marker genuinely
// came through TLS. Anything reaching the loopback port directly cannot come
// from the LAN, and a LAN attacker cannot forge the marker because it cannot
// reach the plaintext port at all.
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

function forwardedProtoValues(request: Request): string[] {
    const forwardedProto = request.headers.get('x-forwarded-proto');
    if (!forwardedProto) return [];

    return forwardedProto
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
}

function isLoopbackHostname(hostname: string): boolean {
    // URL parsing wraps IPv6 literals in brackets; strip them before comparing.
    const normalized = hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;
    return LOOPBACK_HOSTNAMES.has(normalized);
}

/* @Codex */
function isFromLocalTlsProxy(request: Request): boolean {
    const marker = request.headers.get(TLS_PROXY_MARKER_HEADER);
    if (marker?.trim().toLowerCase() !== TLS_PROXY_MARKER_VALUE) return false;

    // The genuine proxy only ever forwards to the loopback Next server, so a
    // proxied request must arrive on a loopback URL. This rejects any attempt to
    // replay the marker header against a non-loopback origin.
    return isLoopbackHostname(new URL(request.url).hostname);
}

/* @Codex */
export function isHttpsRequest(request: Request): boolean {
    // Trustworthy signal: the request URL itself is already https.
    if (new URL(request.url).protocol === HTTPS_PROTOCOL) {
        return true;
    }

    // Otherwise honor x-forwarded-proto ONLY when the request demonstrably came
    // through the local TLS proxy. A forged x-forwarded-proto from any other
    // source is ignored, so it can neither downgrade the LAN paired path nor
    // spoof a secure state on plain-HTTP localhost.
    if (isFromLocalTlsProxy(request) && forwardedProtoValues(request).includes('https')) {
        return true;
    }

    return false;
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
