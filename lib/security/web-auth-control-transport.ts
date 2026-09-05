/* @Codex */
import 'server-only';

import { types } from 'node:util';
import type { NextResponse } from 'next/server';

import { sessionCookieOptionsForRequest } from './request-transport';
import * as lifecycleOwner from './web-auth-lifecycle-owner-adapter';

export const WEB_AUTH_CONTROL_COOKIE_NAME = 'mediflow_auth_control';

const SESSION_COOKIE_NAME = 'mediflow_session';
const CONTROL_TOKEN = /^[A-Za-z0-9_-]{32,256}$/u;
const SESSION_ID = /^[a-f0-9]{64}$/u;
const RANDOM_IDEMPOTENCY_KEY = /^(?:[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/iu;
const STRONG_ETAG = /^"([A-Za-z0-9_-]{32,256})"$/u;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectIsFrozen = Object.isFrozen;
const isProxy = types.isProxy;

export type WebAuthControlMutation = Readonly<{
    controlId: string;
    ifMatch: string;
    idempotencyKey: string;
}>;

export type WebAuthControlBootstrap = Readonly<{
    controlId: string;
    etag: string;
}>;

export type WebAuthControlIssue = Readonly<{
    ok: true;
    sessionId: string;
    etag: string;
}>;

export type WebAuthControlResolution = Readonly<
    | { status: 'active'; projection: unknown }
    | { status: 'owned_denied' }
    | { status: 'absent' }
>;

export type WebAuthControlRetirement = Readonly<{
    outcome: 'completed' | 'denied' | 'failed';
    etag: string;
}>;

type LifecycleOwnerTransportPort = Readonly<{
    bootstrapControl(controlId: unknown): unknown;
    begin(kind: 'login' | 'setup', mutation: WebAuthControlMutation): unknown;
    issue(attempt: unknown, user: unknown): unknown;
    abort(attempt: unknown): boolean;
    resolve(sessionId: unknown, controlId: unknown): unknown;
    retire(projection: unknown, reason: 'lock', mutation: WebAuthControlMutation): unknown;
}>;

type ExactRecord = Readonly<Record<string, unknown>>;

const owner = lifecycleOwner as unknown as Partial<LifecycleOwnerTransportPort>;

function frozenRecord<Value extends object>(value: Value): Readonly<Value> {
    return ObjectFreeze(value) as Readonly<Value>;
}

function exactFrozenRecord(value: unknown, keys: readonly string[]): ExactRecord | null {
    if (!value || typeof value !== 'object' || isProxy(value)) return null;
    try {
        const prototype = ObjectGetPrototypeOf(value);
        if ((prototype !== null && prototype !== Object.prototype) || !ObjectIsFrozen(value)
            || ObjectGetOwnPropertySymbols(value).length !== 0) return null;
        const names = ObjectGetOwnPropertyNames(value);
        if (names.length !== keys.length || keys.some((key) => !names.includes(key))) return null;
        for (const key of keys) {
            const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor) || !descriptor.enumerable
                || descriptor.configurable || descriptor.writable) return null;
        }
        return value as ExactRecord;
    } catch {
        return null;
    }
}

function cookieValue(request: Request, name: string, pattern: RegExp): string | null {
    const header = request.headers.get('cookie');
    if (!header) return null;
    let match: string | null = null;
    for (const field of header.split(';')) {
        const separator = field.indexOf('=');
        if (separator < 1 || field.slice(0, separator).trim() !== name) continue;
        const value = field.slice(separator + 1).trim();
        if (match !== null || !pattern.test(value)) return null;
        match = value;
    }
    return match;
}

/** Reads only one exact opaque control cookie; duplicates and decorated values deny. */
export function webAuthControlIdFromRequest(request: Request): string | null {
    return cookieValue(request, WEB_AUTH_CONTROL_COOKIE_NAME, CONTROL_TOKEN);
}

/** Reads the fixed Web bearer as a locator, never as authority. */
export function webAuthSessionIdFromRequest(request: Request): string | null {
    return cookieValue(request, SESSION_COOKIE_NAME, SESSION_ID);
}

/** Dequotes the one accepted strong ETag representation at the HTTP boundary. */
export function webAuthControlEtagFromHeader(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    return value.match(STRONG_ETAG)?.[1] ?? null;
}

/** Quotes an owner-held opaque fence for the HTTP boundary. */
export function strongWebAuthControlEtag(value: unknown): string | null {
    return typeof value === 'string' && CONTROL_TOKEN.test(value) ? `"${value}"` : null;
}

/** Parses the complete mutation precondition without granting authority. */
export function webAuthControlMutationFromRequest(request: Request): WebAuthControlMutation | null {
    const controlId = webAuthControlIdFromRequest(request);
    const ifMatch = webAuthControlEtagFromHeader(request.headers.get('if-match'));
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!controlId || !ifMatch || !idempotencyKey || !RANDOM_IDEMPOTENCY_KEY.test(idempotencyKey)) return null;
    return frozenRecord({ controlId, ifMatch, idempotencyKey });
}

export function isWebAuthControlMutation(value: unknown): value is WebAuthControlMutation {
    const record = exactFrozenRecord(value, ['controlId', 'ifMatch', 'idempotencyKey']);
    return !!record && typeof record.controlId === 'string' && CONTROL_TOKEN.test(record.controlId)
        && typeof record.ifMatch === 'string' && CONTROL_TOKEN.test(record.ifMatch)
        && typeof record.idempotencyKey === 'string' && RANDOM_IDEMPOTENCY_KEY.test(record.idempotencyKey);
}

/** Bootstraps an absent or unknown process-local control and validates the owner receipt. */
export function bootstrapWebAuthControl(controlId: string | null): WebAuthControlBootstrap | null {
    if (typeof owner.bootstrapControl !== 'function') return null;
    let value: unknown;
    try { value = owner.bootstrapControl(controlId); } catch { return null; }
    const record = exactFrozenRecord(value, ['controlId', 'etag']);
    if (!record || typeof record.controlId !== 'string' || !CONTROL_TOKEN.test(record.controlId)
        || typeof record.etag !== 'string' || !CONTROL_TOKEN.test(record.etag)) return null;
    return value as WebAuthControlBootstrap;
}

export function beginWebAuthControl(kind: 'login' | 'setup', mutation: WebAuthControlMutation): unknown | null {
    if (!isWebAuthControlMutation(mutation) || typeof owner.begin !== 'function') return null;
    try { return owner.begin(kind, mutation) ?? null; } catch { return null; }
}

export function issueWebAuthControl(attempt: unknown, user: unknown): WebAuthControlIssue | null {
    if (typeof owner.issue !== 'function') return null;
    let value: unknown;
    try { value = owner.issue(attempt, user); } catch { return null; }
    const record = exactFrozenRecord(value, ['ok', 'sessionId', 'etag']);
    if (!record || record.ok !== true || typeof record.sessionId !== 'string' || !SESSION_ID.test(record.sessionId)
        || typeof record.etag !== 'string' || !CONTROL_TOKEN.test(record.etag)) return null;
    return value as WebAuthControlIssue;
}

export function abortWebAuthControl(attempt: unknown): boolean {
    if (typeof owner.abort !== 'function') return false;
    try { return owner.abort(attempt) === true; } catch { return false; }
}

export function resolveWebAuthControlSession(sessionId: unknown, controlId: unknown): WebAuthControlResolution | null {
    if (typeof owner.resolve !== 'function') return null;
    let value: unknown;
    try { value = owner.resolve(sessionId, controlId); } catch { return null; }
    const denied = exactFrozenRecord(value, ['status']);
    if (denied && (denied.status === 'owned_denied' || denied.status === 'absent')) {
        return value as WebAuthControlResolution;
    }
    const active = exactFrozenRecord(value, ['status', 'projection']);
    return active?.status === 'active' ? value as WebAuthControlResolution : null;
}

export function retireWebAuthControlForLock(
    projection: unknown,
    mutation: WebAuthControlMutation,
): WebAuthControlRetirement | null {
    if (!isWebAuthControlMutation(mutation) || typeof owner.retire !== 'function') return null;
    let value: unknown;
    try { value = owner.retire(projection, 'lock', mutation); } catch { return null; }
    const record = exactFrozenRecord(value, ['outcome', 'etag']);
    if (!record || (record.outcome !== 'completed' && record.outcome !== 'denied' && record.outcome !== 'failed')
        || typeof record.etag !== 'string' || !CONTROL_TOKEN.test(record.etag)) return null;
    return value as WebAuthControlRetirement;
}

export function setWebAuthControlEtag(response: Response, etag: unknown): boolean {
    const header = strongWebAuthControlEtag(etag);
    if (!header) return false;
    response.headers.set('ETag', header);
    response.headers.set('Cache-Control', 'no-store');
    return true;
}

export function setWebAuthControlCookie(
    response: NextResponse,
    request: Request,
    controlId: unknown,
): boolean {
    if (typeof controlId !== 'string' || !CONTROL_TOKEN.test(controlId)) return false;
    response.cookies.set(WEB_AUTH_CONTROL_COOKIE_NAME, controlId, sessionCookieOptionsForRequest(request));
    return true;
}
