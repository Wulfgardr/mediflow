/* @Codex */
import { randomUUID } from 'node:crypto';

const STRONG_ETAG = /^"[A-Za-z0-9_-]{32,256}"$/u;
const CONTROL_COOKIE = /^[A-Za-z0-9_-]{32,256}$/u;
const SESSION_COOKIE = /^[a-f0-9]{64}$/u;

function responseCookies(response) {
    if (typeof response.headers.getSetCookie === 'function') return response.headers.getSetCookie();
    const combined = response.headers.get('set-cookie');
    return combined ? [combined] : [];
}

function exactCookie(response, name, pattern, required) {
    const values = [];
    for (const field of responseCookies(response)) {
        const match = field.match(new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`, 'u'));
        if (match) values.push(match[1]);
    }
    if (values.length === 0 && !required) return null;
    if (values.length !== 1 || !pattern.test(values[0])) {
        throw new Error(`Invalid ${name} response cookie.`);
    }
    return `${name}=${values[0]}`;
}

function strongEtag(response, label) {
    const etag = response.headers.get('etag');
    if (!etag || !STRONG_ETAG.test(etag)) throw new Error(`${label} response lacks a strong auth control ETag.`);
    return etag;
}

async function responseJson(response) {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); }
    catch { return null; }
}

/** Synthetic-only helper for test clients that cannot inherit the browser auth-control transport. */
export async function loginWithWebAuthControl(baseUrl, credentials, fetchImplementation = fetch) {
    const checkResponse = await fetchImplementation(new URL('/api/auth/check', baseUrl), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store' },
    });
    const controlEtag = strongEtag(checkResponse, 'Auth check');
    const controlCookie = exactCookie(checkResponse, 'mediflow_auth_control', CONTROL_COOKIE, true);

    const response = await fetchImplementation(new URL('/api/auth/login', baseUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Cookie: controlCookie,
            'If-Match': controlEtag,
            'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify(credentials),
    });
    const successorEtag = strongEtag(response, 'Auth login');
    const json = await responseJson(response);
    const sessionCookie = exactCookie(response, 'mediflow_session', SESSION_COOKIE, false);
    return Object.freeze({ response, json, sessionCookie, controlCookie, controlEtag: successorEtag });
}
