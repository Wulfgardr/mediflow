/* @Codex */
import 'server-only';

import { types } from 'node:util';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { users } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import type { ServerSessionProjectionOwner } from '@/lib/security/server-session-projection-owner';
import { serverSessionProjectionOwnerRegistry } from '@/lib/security/server-session-projection-owner-production';
import {
    resolve as resolveWebSession,
    retireForUser as retireWebSessionsForProjectionUser,
    type WebSessionProjection,
} from '@/lib/security/web-auth-lifecycle-owner-adapter';

const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectIsFrozen = Object.isFrozen;
const ObjectPrototype = Object.prototype;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const PromisePrototype = Promise.prototype;
const PromiseThen = PromisePrototype.then;
const TypesIsProxy = types.isProxy;
const TypesIsPromise = types.isPromise;
const DateNow = Date.now;
const NumberIsSafeInteger = Number.isSafeInteger;

const SESSION_COOKIE_NAME = 'mediflow_session';
const CONTROL_COOKIE_NAME = 'mediflow_auth_control';
const SESSION_ID = /^[a-f0-9]{64}$/u;
const CONTROL_ID = /^[A-Za-z0-9_-]{32,256}$/u;
const AUTH_SESSION_KEYS = ['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt'] as const;
const AUTH_COOKIE_KEYS = ['name', 'value'] as const;
const AUTH_COOKIE_WITH_PATH_KEYS = ['name', 'value', 'path'] as const;
const AUTH_USER_KEYS = ['id', 'username', 'role'] as const;
const OWNER_METHOD_KEYS = [
    'snapshotSelectionEpoch',
    'snapshotReviewContextEpoch',
    'acquireProjectionIngest',
    'resolveProjectionService',
    'issueSelection',
    'dereferenceSelection',
    'withLeaseCriticalSection',
    'dispose',
] as const;

export type ServerSession = Readonly<{
    id: string;
    userId: string;
    username: string;
    role: string;
    authChannel: 'web' | 'native' | 'system';
    createdAt: number;
    expiresAt: number;
}>;

function ambientThenSafe(): boolean {
    try {
        return ObjectGetOwnPropertyDescriptor(ObjectPrototype, 'then') === undefined;
    } catch {
        return false;
    }
}

function isPromiseObject(value: unknown): value is object {
    try {
        return typeof value === 'object' && value !== null && !TypesIsProxy(value) && TypesIsPromise(value);
    } catch {
        return false;
    }
}

function isNativePromise(value: unknown): value is Promise<unknown> {
    if (!isPromiseObject(value)) return false;
    try {
        return ObjectGetPrototypeOf(value) === PromisePrototype;
    } catch {
        return false;
    }
}

function discardNativePromise(value: Promise<unknown>): void {
    try {
        ReflectApply(PromiseThen, value, [() => undefined, () => undefined]);
    } catch {
        // The already-validated native Promise remains fail-closed if observation fails.
    }
}

function exactDataRecord(value: unknown, keys: readonly string[], prototype: object | null): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null) return null;
    try {
        if (TypesIsProxy(value) || ObjectGetPrototypeOf(value) !== prototype) return null;
        const ownKeys = ReflectOwnKeys(value);
        if (ownKeys.length !== keys.length) return null;
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index]!;
            let present = false;
            for (let ownIndex = 0; ownIndex < ownKeys.length; ownIndex += 1) {
                if (ownKeys[ownIndex] === key) { present = true; break; }
            }
            if (!present) return null;
            const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
        }
        return value as Record<string, unknown>;
    } catch {
        return null;
    }
}

function exactFrozenOwnerRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    const record = exactDataRecord(value, keys, null);
    if (!record) return null;
    try {
        if (!ObjectIsFrozen(value)) return null;
        for (const key of keys) {
            const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || descriptor.configurable || descriptor.writable) return null;
        }
        return record;
    } catch {
        return null;
    }
}

function exactCookieValue(value: unknown, name: string, pattern: RegExp): string | null {
    const record = exactDataRecord(value, AUTH_COOKIE_KEYS, ObjectPrototype)
        ?? exactDataRecord(value, AUTH_COOKIE_WITH_PATH_KEYS, ObjectPrototype);
    const path = record ? ObjectGetOwnPropertyDescriptor(record, 'path') : null;
    return record?.name === name && typeof record.value === 'string'
        && (!path || path.value === '/') && pattern.test(record.value)
        ? record.value
        : null;
}

function isProjectionOwner(value: unknown): value is ServerSessionProjectionOwner {
    if (typeof value !== 'object' || value === null) return false;
    try {
        if (TypesIsProxy(value)) return false;
        for (let index = 0; index < OWNER_METHOD_KEYS.length; index += 1) {
            const descriptor = ObjectGetOwnPropertyDescriptor(value, OWNER_METHOD_KEYS[index]!);
            if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') return false;
        }
        return true;
    } catch {
        return false;
    }
}

function activeWebProjection(sessionId: unknown, controlId: unknown): WebSessionProjection | null {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)
        || typeof controlId !== 'string' || !CONTROL_ID.test(controlId)) return null;
    let resolution: unknown;
    try { resolution = resolveWebSession(sessionId, controlId); } catch { return null; }
    const resolved = exactFrozenOwnerRecord(resolution, ['status', 'projection']);
    if (!resolved || resolved.status !== 'active') return null;
    const projection = exactFrozenOwnerRecord(resolved.projection, AUTH_SESSION_KEYS);
    if (!projection || projection.id !== sessionId
        || typeof projection.userId !== 'string' || projection.userId.length === 0
        || typeof projection.username !== 'string' || projection.username.length === 0
        || typeof projection.role !== 'string' || projection.role.length === 0
        || projection.authChannel !== 'web'
        || typeof projection.createdAt !== 'number' || !NumberIsSafeInteger(projection.createdAt)
        || typeof projection.expiresAt !== 'number' || !NumberIsSafeInteger(projection.expiresAt)
        || projection.expiresAt <= DateNow()) return null;
    return resolved.projection as WebSessionProjection;
}

function validatedUserAgreesWithActiveWebSession(user: unknown, session: WebSessionProjection): boolean {
    const userRecord = exactDataRecord(user, AUTH_USER_KEYS, ObjectPrototype);
    if (!userRecord || userRecord.id !== session.userId
        || userRecord.username !== session.username
        || (userRecord.role !== null && userRecord.role !== undefined && typeof userRecord.role !== 'string')) return false;
    return ((userRecord.role as string | null | undefined) ?? session.role) === session.role;
}

function retireActiveWebSessionsForProjectionUser(projection: WebSessionProjection): void {
    try {
        retireWebSessionsForProjectionUser(projection);
    } catch {
        // The request remains denied even if terminal cleanup reports a failure.
    }
}

async function validateProjectionAgainstDatabase(projection: WebSessionProjection): Promise<WebSessionProjection | null> {
    const user = await dbServer
        .select({ id: users.id, username: users.username, role: users.role })
        .from(users)
        .where(eq(users.id, projection.userId))
        .get();
    if (validatedUserAgreesWithActiveWebSession(user, projection)) return projection;
    retireActiveWebSessionsForProjectionUser(projection);
    return null;
}

async function resolveValidatedActiveWebSession(): Promise<WebSessionProjection | null> {
    try {
        const cookieStore = await cookies();
        const sessionId = exactCookieValue(cookieStore.get(SESSION_COOKIE_NAME), SESSION_COOKIE_NAME, SESSION_ID);
        const controlId = exactCookieValue(cookieStore.get(CONTROL_COOKIE_NAME), CONTROL_COOKIE_NAME, CONTROL_ID);
        const projection = activeWebProjection(sessionId, controlId);
        return projection ? await validateProjectionAgainstDatabase(projection) : null;
    } catch {
        return null;
    }
}

export async function requireSession(): Promise<WebSessionProjection | null> {
    return resolveValidatedActiveWebSession();
}

export async function readAuthenticatedWebSession(): Promise<WebSessionProjection | null> {
    return resolveValidatedActiveWebSession();
}

export type AuthenticatedWebSessionProjectionOwnerContext = Readonly<{
    session: ServerSession;
    owner: ServerSessionProjectionOwner;
}>;

function authenticatedProjectionOwnerContext(
    session: ServerSession,
    owner: ServerSessionProjectionOwner,
): AuthenticatedWebSessionProjectionOwnerContext {
    const context = ObjectCreate(null) as AuthenticatedWebSessionProjectionOwnerContext;
    ObjectDefineProperty(context, 'session', { value: session, writable: false, enumerable: true, configurable: false });
    ObjectDefineProperty(context, 'owner', { value: owner, writable: false, enumerable: true, configurable: false });
    return ObjectFreeze(context);
}

export async function acquireAuthenticatedWebSessionProjectionOwnerContext(): Promise<AuthenticatedWebSessionProjectionOwnerContext | null> {
    try {
        if (!ambientThenSafe()) return null;
        const cookiePromise = cookies();
        const nativeCookiePromise = isNativePromise(cookiePromise) ? cookiePromise : null;
        if (!ambientThenSafe()) { if (nativeCookiePromise) discardNativePromise(nativeCookiePromise); return null; }
        if (!nativeCookiePromise) return null;

        const cookieStore = await nativeCookiePromise;
        if (!ambientThenSafe() || (typeof cookieStore !== 'object' && typeof cookieStore !== 'function') || cookieStore === null) return null;
        const cookieGet = (cookieStore as { get?: unknown }).get;
        if (!ambientThenSafe() || typeof cookieGet !== 'function') return null;
        const bearerCookie = ReflectApply(cookieGet, cookieStore, [SESSION_COOKIE_NAME]);
        if (!ambientThenSafe()) return null;
        const controlCookie = ReflectApply(cookieGet, cookieStore, [CONTROL_COOKIE_NAME]);
        if (!ambientThenSafe()) return null;
        const sessionId = exactCookieValue(bearerCookie, SESSION_COOKIE_NAME, SESSION_ID);
        const controlId = exactCookieValue(controlCookie, CONTROL_COOKIE_NAME, CONTROL_ID);
        if (!sessionId || !controlId) return null;

        const projection = activeWebProjection(sessionId, controlId);
        if (!ambientThenSafe() || !projection) return null;
        const userIdPredicate = eq(users.id, projection.userId);
        if (!ambientThenSafe()) return null;
        const selected = dbServer.select({ id: users.id, username: users.username, role: users.role });
        if (!ambientThenSafe()) return null;
        const fromUsers = selected.from(users);
        if (!ambientThenSafe()) return null;
        const filtered = fromUsers.where(userIdPredicate);
        if (!ambientThenSafe()) return null;
        const user = filtered.get();
        if (!ambientThenSafe()) return null;
        if (!validatedUserAgreesWithActiveWebSession(user, projection)) {
            retireActiveWebSessionsForProjectionUser(projection);
            if (!ambientThenSafe()) return null;
            return null;
        }

        const owner = serverSessionProjectionOwnerRegistry.acquire(projection);
        if (!ambientThenSafe() || !isProjectionOwner(owner)) return null;
        return authenticatedProjectionOwnerContext(projection, owner);
    } catch {
        return null;
    }
}

export async function acquireAuthenticatedWebSessionProjectionOwner() {
    return (await acquireAuthenticatedWebSessionProjectionOwnerContext())?.owner ?? null;
}

function buildLocalApiSystemSession(): ServerSession {
    const now = Date.now();
    return {
        id: 'local-api', userId: 'local-api', username: 'local-api', role: 'admin', authChannel: 'system',
        createdAt: now, expiresAt: now + 1000 * 60 * 60,
    };
}

export async function requireSessionOrLocalToken(request: Request): Promise<ServerSession | null> {
    const session = await requireSession();
    if (session) return session;
    if (requireLocalApiToken(request)) return null;
    return buildLocalApiSystemSession();
}

export async function requireLocalApiActorSession(request: Request): Promise<ServerSession | null> {
    if (requireLocalApiToken(request)) return null;
    const session = await requireSession();
    if (session) return { ...session, id: `native:${session.userId}`, authChannel: 'native' };
    return buildLocalApiSystemSession();
}

export function unauthorizedResponse() {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbiddenResponse() {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
