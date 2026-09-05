/* @Codex */
import 'server-only';

import { types } from 'node:util';

import {
    auditContextFromSession,
    hashAuditRef,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from './audit';
import { strongWebAuthControlEtag } from './web-auth-control-transport';
import {
    resolve as resolveWebSession,
    retire as retireWebSession,
    type WebRetirementReceipt,
    type WebSessionProjection,
    type WebSessionResolution,
} from './web-auth-lifecycle-owner-adapter';

const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const ObjectIsFrozen = Object.isFrozen;
const isProxy = types.isProxy;
const DateNow = Date.now;
const SESSION_COOKIE_NAME = 'mediflow_session';
const CONTROL_COOKIE_NAME = 'mediflow_auth_control';
const SESSION_KEYS = Object.freeze(['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt']);
const SESSION_ID = /^[a-f0-9]{64}$/u;
const CONTROL_ID = /^[A-Za-z0-9_-]{32,256}$/u;

type ExactRecord = Readonly<Record<string, unknown>>;

export type WebAuthLogoutSources = Readonly<{
    resolve(sessionId: unknown, controlId: unknown): WebSessionResolution;
    retire(projection: unknown, reason: 'delete'): WebRetirementReceipt;
    audit(session: WebSessionProjection, sessionId: string, request: Request): unknown;
}>;

function exactRecord(value: unknown, keys: readonly string[], prototype: object | null, frozen: boolean): ExactRecord | null {
    if (!value || typeof value !== 'object' || isProxy(value)) return null;
    try {
        if (ObjectGetPrototypeOf(value) !== prototype || (frozen && !ObjectIsFrozen(value))
            || ObjectGetOwnPropertySymbols(value).length !== 0) return null;
        const names = ObjectGetOwnPropertyNames(value);
        if (names.length !== keys.length) return null;
        for (const key of keys) {
            if (!names.includes(key)) return null;
            const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return null;
            if (frozen && (descriptor.configurable || descriptor.writable)) return null;
        }
        return value as ExactRecord;
    } catch { return null; }
}

function exactCookie(value: unknown, name: string, pattern: RegExp): string | null {
    const plain = exactRecord(value, ['name', 'value'], Object.prototype, false);
    const framework = plain ? null : exactRecord(value, ['name', 'value', 'path'], Object.prototype, false);
    const record = plain ?? (framework?.path === '/' ? framework : null);
    return record?.name === name && typeof record.value === 'string' && pattern.test(record.value)
        ? record.value
        : null;
}

function exactActiveWebProjection(value: unknown, sessionId: string): WebSessionProjection | null {
    const resolution = exactRecord(value, ['status', 'projection'], null, true);
    if (!resolution || resolution.status !== 'active') return null;
    const projection = exactRecord(resolution.projection, SESSION_KEYS, null, true);
    if (!projection || projection.id !== sessionId || projection.authChannel !== 'web'
        || typeof projection.userId !== 'string' || !projection.userId
        || typeof projection.username !== 'string' || !projection.username
        || typeof projection.role !== 'string' || !projection.role
        || typeof projection.createdAt !== 'number' || !Number.isSafeInteger(projection.createdAt)
        || typeof projection.expiresAt !== 'number' || !Number.isSafeInteger(projection.expiresAt)
        || projection.expiresAt <= DateNow()) return null;
    return resolution.projection as WebSessionProjection;
}

function retirementReceipt(value: unknown): { outcome: 'completed' | 'denied' | 'failed'; etag: string | null } | null {
    const oneField = exactRecord(value, ['outcome'], null, true);
    const twoFields = oneField ? null : exactRecord(value, ['outcome', 'etag'], null, true);
    const record = oneField ?? twoFields;
    if (!record || (record.outcome !== 'completed' && record.outcome !== 'denied' && record.outcome !== 'failed')) return null;
    if (!twoFields) return { outcome: record.outcome, etag: null };
    const etag = strongWebAuthControlEtag(twoFields.etag);
    return etag ? { outcome: record.outcome, etag } : null;
}

function empty(status: 204 | 401 | 409, etag: string | null = null): Response {
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    if (etag) headers.set('ETag', etag);
    return new Response(null, { status, headers });
}

const productionSources: WebAuthLogoutSources = Object.freeze({
    resolve: resolveWebSession,
    retire: retireWebSession,
    audit: async (session: WebSessionProjection, sessionId: string, request: Request) => {
        const context = auditContextFromSession(session);
        await writeAuditEvent({
            eventType: 'auth.logout', outcome: 'success', actorType: context.actorType, actorRef: context.actorRef,
            subjectType: 'session', subjectRef: hashAuditRef(sessionId), sourceSurface: context.sourceSurface,
            requestId: requestIdFromRequest(request), redactedMetadata: withAuditContextMetadata(context, null),
        });
    },
});

/** Retires only the exact ACTIVE Web projection bound to both fixed cookies. */
export async function completeExactWebP3Logout(
    bearerCookie: unknown,
    controlCookie: unknown,
    request: Request,
    sources: WebAuthLogoutSources = productionSources,
): Promise<Response> {
    const sessionId = exactCookie(bearerCookie, SESSION_COOKIE_NAME, SESSION_ID);
    const controlId = exactCookie(controlCookie, CONTROL_COOKIE_NAME, CONTROL_ID);
    if (!sessionId || !controlId) return empty(401);
    let projection: WebSessionProjection | null;
    try { projection = exactActiveWebProjection(sources.resolve(sessionId, controlId), sessionId); }
    catch { return empty(401); }
    if (!projection) return empty(401);
    let receipt: ReturnType<typeof retirementReceipt>;
    try { receipt = retirementReceipt(sources.retire(projection, 'delete')); }
    catch { return empty(409); }
    if (!receipt) return empty(409);
    if (receipt.outcome !== 'completed') return empty(409, receipt.etag);
    try { await sources.audit(projection, sessionId, request); } catch { /* Terminal retirement is authoritative. */ }
    return empty(204, receipt.etag);
}
