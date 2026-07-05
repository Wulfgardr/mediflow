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

// D1 (WAVE 2 security hardening): the plaintext Next server binds loopback only
// and the proxy's HTTP target is validated as loopback in the proxy itself. A
// LAN attacker therefore cannot reach the plaintext port to inject the marker,
// so the marker alone authoritatively proves the request arrived over TLS.
//
// We deliberately do NOT gate on the request URL host being loopback: the proxy
// forwards the client's original Host header untouched (see
// scripts/local-api-tls-proxy.mjs spreading ...req.headers), so a genuine remote
// paired device produces a non-loopback host (a .local mDNS name or LAN IP).
// Requiring a loopback URL here would wrongly downgrade that path to secure:false
// and break the LAN paired requirement.
function forwardedProtoValues(request: Request): string[] {
    const forwardedProto = request.headers.get('x-forwarded-proto');
    if (!forwardedProto) return [];

    return forwardedProto
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
}

/* @Codex */
function isFromLocalTlsProxy(request: Request): boolean {
    // The proxy authoritatively overwrites this marker on every forwarded request
    // (it is set after ...req.headers is spread, so a client-supplied value cannot
    // survive), and a LAN client cannot reach the loopback-only plaintext port to
    // inject it directly. The marker's presence is therefore sufficient proof.
    const marker = request.headers.get(TLS_PROXY_MARKER_HEADER);
    return marker?.trim().toLowerCase() === TLS_PROXY_MARKER_VALUE;
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
