import { createAgentMandateStore } from '../agent-mandate-store';
import { openDbServer } from '../db-server';
import { archiveGenerationForSession } from './archive-session-generation';
import 'server-only';

import { hasAttestedLoopbackIngress } from './loopback-ingress.mjs';
import { presentedWebSessionProof, webSessionProofBindings } from './web-session-proof';
import { types } from 'node:util';

import {
    APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION,
    createApplicationLockResponse,
    type ApplicationLockReceipt,
} from './application-lock-server';
import {
    auditContextFromSession,
    hashAuditRef,
    requestIdFromRequest,
    withAuditContextMetadata,
    writeAuditEvent,
} from './audit';
import {
    SESSION_COOKIE_NAME,
    type ServerSession,
} from './server-session';
import {
    isWebAuthControlMutation,
    resolveWebAuthControlSession,
    retireWebAuthControlForLock,
    setWebAuthControlEtag,
    type WebAuthControlMutation,
} from './web-auth-control-transport';
import { mintResourcePort, registerPrivateResource, releaseResourcePort } from './web-auth-lifecycle-owner-adapter';

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

export type WebAuthApplicationLockSources = Readonly<{
    resolve(sessionId: unknown, controlId: unknown, request: Request): unknown;
    retire(projection: ServerSession | null, reason: 'lock', mutation: WebAuthControlMutation, request: Request): unknown;
    audit(session: ServerSession, sessionId: string, request: Request): unknown;
}>;

const confirmedReceipt: ApplicationLockReceipt = Object.freeze({
    schemaVersion: APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION,
    state: 'server_invalidation_confirmed',
});
const unconfirmedReceipt: ApplicationLockReceipt = Object.freeze({
    schemaVersion: APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION,
    state: 'server_invalidation_unconfirmed',
});

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
    const record = exactRecord(cookie, ['name', 'value'], ObjectPrototype, false)
        ?? exactRecord(cookie, ['name', 'value', 'path'], ObjectPrototype, false);
    const path = record ? ObjectGetOwnPropertyDescriptor(record, 'path') : null;
    if (!record || record.name !== SESSION_COOKIE_NAME || typeof record.value !== 'string'
        || (path && path.value !== '/')
        || !SESSION_ID.test(record.value)) return null;
    return record.value;
}

function exactActiveWebSession(value: unknown, sessionId: string): ServerSession | null {
    const record = exactRecord(value, SESSION_KEYS, ObjectPrototype, true)
        ?? exactRecord(value, SESSION_KEYS, null, true);
    if (!record || record.id !== sessionId || record.authChannel !== 'web'
        || typeof record.userId !== 'string' || !record.userId
        || typeof record.username !== 'string' || !record.username
        || typeof record.role !== 'string' || !record.role
        || typeof record.createdAt !== 'number' || !Number.isSafeInteger(record.createdAt)
        || typeof record.expiresAt !== 'number' || !Number.isSafeInteger(record.expiresAt)) return null;
    return value as ServerSession;
}

function exactActiveResolution(value: unknown, sessionId: string): ServerSession | null {
    const record = exactRecord(value, ['status', 'projection'], null, true)
        ?? exactRecord(value, ['status', 'projection'], ObjectPrototype, true);
    return record?.status === 'active' ? exactActiveWebSession(record.projection, sessionId) : null;
}

function exactRetirementReceipt(value: unknown): { outcome: string; etag: string } | null {
    const record = exactRecord(value, ['outcome', 'etag'], null, true)
        ?? exactRecord(value, ['outcome', 'etag'], ObjectPrototype, true);
    if (!record || (record.outcome !== 'completed' && record.outcome !== 'denied' && record.outcome !== 'failed')
        || typeof record.etag !== 'string') return null;
    return { outcome: record.outcome, etag: record.etag };
}

const productionSources: WebAuthApplicationLockSources = Object.freeze({
    resolve: resolveWebAuthControlSession,
    retire(session: ServerSession | null, _reason: 'lock', mutation: WebAuthControlMutation, request: Request) {
        const proof = presentedWebSessionProof(request.headers);
        if (!proof || !hasAttestedLoopbackIngress(request)
            || !webSessionProofBindings.controlAvailable(mutation.controlId, proof)) return null;
        if (!session || request.headers.get('x-mediflow-lock-reason') === 'inactivity') {
            return retireWebAuthControlForLock(session, mutation);
        }
        const port = mintResourcePort(session);
        try {
            const registered = port && registerPrivateResource(port, reason => {
                if (reason !== 'lock') return;
                const generation = archiveGenerationForSession(session);
                if (!generation) throw new Error('AGENT_MANDATE_LOCK_ARCHIVE_UNAVAILABLE');
                createAgentMandateStore(openDbServer()).revokeAll(session.userId, generation);
            });
            const receipt = retireWebAuthControlForLock(session, mutation);
            return !registered && receipt?.outcome === 'completed'
                ? Object.freeze({ outcome: 'failed', etag: receipt.etag }) : receipt;
        } finally { if (port) releaseResourcePort(port); }
    },
    audit: async (session: ServerSession, sessionId: string, request: Request) => {
        const context = auditContextFromSession(session);
        await writeAuditEvent({
            eventType: 'auth.lock', outcome: 'success', actorType: context.actorType, actorRef: context.actorRef,
            subjectType: 'session', subjectRef: hashAuditRef(sessionId), sourceSurface: context.sourceSurface,
            requestId: requestIdFromRequest(request), redactedMetadata: withAuditContextMetadata(context, null),
        });
    },
});

/** Advances the exact control fence and retires its ACTIVE projection when one is present. */
export async function completeExactWebP3ApplicationLock(
    cookie: unknown,
    mutation: unknown,
    request: Request,
    sources: WebAuthApplicationLockSources = productionSources,
): Promise<Response> {
    const sessionId = exactBearer(cookie);
    if (!isWebAuthControlMutation(mutation)) return createApplicationLockResponse(unconfirmedReceipt);
    let session: ServerSession | null = null;
    if (sessionId) {
        try { session = exactActiveResolution(sources.resolve(sessionId, mutation.controlId, request), sessionId); }
        catch { /* A valid control mutation still advances the revocation fence below. */ }
    }
    let ownerReceipt: unknown;
    try { ownerReceipt = sources.retire(session, 'lock', mutation, request); }
    catch { return createApplicationLockResponse(unconfirmedReceipt); }
    const receipt = exactRetirementReceipt(ownerReceipt);
    if (!receipt) return createApplicationLockResponse(unconfirmedReceipt);
    if (receipt.outcome !== 'completed') {
        const response = createApplicationLockResponse(unconfirmedReceipt);
        setWebAuthControlEtag(response, receipt.etag);
        return response;
    }
    if (session && sessionId) {
        try { await sources.audit(session, sessionId, request); } catch { /* Terminal retirement is authoritative. */ }
    }
    const response = createApplicationLockResponse(confirmedReceipt);
    setWebAuthControlEtag(response, receipt.etag);
    return response;
}
