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
import {
    dispatchActiveWebServerSessionRetirement,
    resolveActiveWebServerSession,
    SESSION_COOKIE_NAME,
    type ServerSession,
    type WebServerSessionRetirementCleanupReceipt,
} from './server-session';

const ObjectPrototype = Object.prototype;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const ObjectIsFrozen = Object.isFrozen;
const isProxy = types.isProxy;
const SESSION_KEYS = Object.freeze(['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt']);
const SESSION_ID = /^[a-f0-9]{64}$/u;

type ExactRecord = Readonly<Record<string, unknown>>;

export type WebAuthLogoutSources = Readonly<{
    resolve(sessionId: unknown): ServerSession | null;
    retire(sessionId: unknown, reason: 'delete'): WebServerSessionRetirementCleanupReceipt;
    audit(session: ServerSession, sessionId: string, request: Request): unknown;
}>;

function exactRecord(value: unknown, keys: readonly string[], prototype: object | null, frozen: boolean): ExactRecord | null {
    if (!value || typeof value !== 'object' || isProxy(value)) return null;
    try {
        if (ObjectGetPrototypeOf(value) !== prototype || (frozen && !ObjectIsFrozen(value))
            || ObjectGetOwnPropertySymbols(value).length !== 0) return null;
        const names = ObjectGetOwnPropertyNames(value);
        if (names.length !== keys.length) return null;
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index];
            if (names[index] !== key) return null;
            const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return null;
            if (frozen && (descriptor.configurable || descriptor.writable)) return null;
        }
        return value as ExactRecord;
    } catch { return null; }
}

function exactBearer(cookie: unknown): string | null {
    const record = exactRecord(cookie, ['name', 'value'], ObjectPrototype, false);
    if (!record || record.name !== SESSION_COOKIE_NAME || typeof record.value !== 'string'
        || !SESSION_ID.test(record.value)) return null;
    return record.value;
}

function exactActiveWebSession(value: unknown, sessionId: string): ServerSession | null {
    const record = exactRecord(value, SESSION_KEYS, ObjectPrototype, true);
    if (!record || record.id !== sessionId || record.authChannel !== 'web'
        || typeof record.userId !== 'string' || !record.userId
        || typeof record.username !== 'string' || !record.username
        || typeof record.role !== 'string' || !record.role
        || typeof record.createdAt !== 'number' || !Number.isSafeInteger(record.createdAt)
        || typeof record.expiresAt !== 'number' || !Number.isSafeInteger(record.expiresAt)) return null;
    return value as ServerSession;
}

function completedReceipt(value: unknown): boolean {
    const record = exactRecord(value, ['outcome'], null, true);
    return record?.outcome === 'completed';
}

function empty(status: 204 | 401 | 409): Response {
    return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

const productionSources: WebAuthLogoutSources = Object.freeze({
    resolve: resolveActiveWebServerSession,
    retire: dispatchActiveWebServerSessionRetirement,
    audit: async (session: ServerSession, sessionId: string, request: Request) => {
        const context = auditContextFromSession(session);
        await writeAuditEvent({
            eventType: 'auth.logout', outcome: 'success', actorType: context.actorType, actorRef: context.actorRef,
            subjectType: 'session', subjectRef: hashAuditRef(sessionId), sourceSurface: context.sourceSurface,
            requestId: requestIdFromRequest(request), redactedMetadata: withAuditContextMetadata(context, null),
        });
    },
});

/** Retires only the exact ACTIVE Web P3 named by the fixed bearer. */
/* @Codex */
export async function completeExactWebP3Logout(
    cookie: unknown,
    request: Request,
    sources: WebAuthLogoutSources = productionSources,
): Promise<Response> {
    const sessionId = exactBearer(cookie);
    if (!sessionId) return empty(401);
    let session: ServerSession | null;
    try { session = exactActiveWebSession(sources.resolve(sessionId), sessionId); }
    catch { return empty(401); }
    if (!session) return empty(401);
    let receipt: unknown;
    try { receipt = sources.retire(sessionId, 'delete'); }
    catch { return empty(409); }
    if (!completedReceipt(receipt)) return empty(409);
    try { await sources.audit(session, sessionId, request); } catch { /* Terminal retirement is authoritative. */ }
    return empty(204);
}
