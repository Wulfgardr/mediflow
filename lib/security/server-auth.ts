/* @Codex */
import 'server-only';

import { types } from 'node:util';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { users } from '@/lib/schema';
import {
    resolveActiveWebServerSession,
    retireWebP3SessionsForUser,
    SESSION_COOKIE_NAME,
    type ServerSession,
} from '@/lib/security/server-session';
import type { ServerSessionProjectionOwner } from '@/lib/security/server-session-projection-owner';
import { serverSessionProjectionOwnerRegistry } from '@/lib/security/server-session-projection-owner-production';
/* @Codex */
import { requireLocalApiToken } from '@/lib/security/local-api-auth';

const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const PromiseConstructor = Promise;
const PromisePrototype = Promise.prototype;
const PromiseResolve = Promise.resolve;
const PromiseThen = PromisePrototype.then;
const TypesIsProxy = types.isProxy;
const TypesIsPromise = types.isPromise;
const DateNow = Date.now;
const NumberIsFinite = Number.isFinite;

const AUTH_SESSION_KEYS = ['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt'] as const;
const AUTH_COOKIE_KEYS = ['name', 'value'] as const;
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

function discardPromise(value: unknown): void {
    if (!isPromiseObject(value)) return;
    try {
        const observed = ReflectApply(PromiseResolve, PromiseConstructor, [value]) as Promise<unknown>;
        const settled = ReflectApply(PromiseThen, observed, [() => undefined, () => undefined]) as Promise<unknown>;
        ReflectApply(PromiseThen, settled, [() => undefined, () => undefined]);
    } catch {
        // A hostile non-native Promise is denied; cleanup remains best effort and opaque.
    }
}

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null) return null;
    try {
        if (TypesIsProxy(value) || ObjectGetPrototypeOf(value) !== ObjectPrototype) return null;
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

function validatedUserAgreesWithActiveWebSession(
    user: unknown,
    sessionRecord: Record<string, unknown>,
): boolean {
    const userRecord = exactDataRecord(user, AUTH_USER_KEYS);
    if (!userRecord || userRecord.id !== sessionRecord.userId
        || userRecord.username !== sessionRecord.username
        || (userRecord.role !== null && userRecord.role !== undefined && typeof userRecord.role !== 'string')) return false;
    const effectiveRole = (userRecord.role as string | null | undefined) ?? sessionRecord.role;
    return effectiveRole === sessionRecord.role;
}

function retireActiveWebSessionsForUser(userId: unknown): void {
    try {
        retireWebP3SessionsForUser(userId);
    } catch {
        // Retirement is fail-closed: a denial or failure cannot preserve this request's authority.
    }
}

async function resolveValidatedActiveWebSession(): Promise<ServerSession | null> {
    try {
        const cookieStore = await cookies();
        const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
        const session = resolveActiveWebServerSession(sessionId);
        if (!session || !sessionId) return null;
        const sessionRecord = exactDataRecord(session, AUTH_SESSION_KEYS);
        if (!sessionRecord || sessionRecord.id !== sessionId
            || typeof sessionRecord.userId !== 'string' || sessionRecord.userId.length === 0
            || typeof sessionRecord.username !== 'string' || sessionRecord.username.length === 0
            || typeof sessionRecord.role !== 'string' || sessionRecord.role.length === 0
            || sessionRecord.authChannel !== 'web'
            || typeof sessionRecord.createdAt !== 'number' || !NumberIsFinite(sessionRecord.createdAt)
            || typeof sessionRecord.expiresAt !== 'number' || !NumberIsFinite(sessionRecord.expiresAt)
            || sessionRecord.expiresAt <= DateNow()) return null;

        const user = await dbServer
            .select({
                id: users.id,
                username: users.username,
                role: users.role,
            })
            .from(users)
            .where(eq(users.id, sessionRecord.userId))
            .get();
        if (!validatedUserAgreesWithActiveWebSession(user, sessionRecord)) {
            retireActiveWebSessionsForUser(sessionRecord.userId);
            return null;
        }
        return session;
    } catch {
        return null;
    }
}

export async function requireSession(): Promise<ServerSession | null> {
    return resolveValidatedActiveWebSession();
}

/* @Codex */
export async function readAuthenticatedWebSession(): Promise<ServerSession | null> {
    return resolveValidatedActiveWebSession();
}

export type AuthenticatedWebSessionProjectionOwnerContext = Readonly<{
    session: ServerSession; owner: ServerSessionProjectionOwner;
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

/* @Codex */
export async function acquireAuthenticatedWebSessionProjectionOwnerContext(): Promise<AuthenticatedWebSessionProjectionOwnerContext | null> {
    try {
        if (!ambientThenSafe()) return null;

        const cookiePromise = cookies();
        if (!ambientThenSafe()) { discardPromise(cookiePromise); return null; }
        if (!isNativePromise(cookiePromise)) { discardPromise(cookiePromise); return null; }

        const cookieStore = await cookiePromise;
        if (!ambientThenSafe() || (typeof cookieStore !== 'object' && typeof cookieStore !== 'function') || cookieStore === null) return null;

        const cookieGet = (cookieStore as { get?: unknown }).get;
        if (!ambientThenSafe() || typeof cookieGet !== 'function') return null;
        const cookie = ReflectApply(cookieGet, cookieStore, [SESSION_COOKIE_NAME]);
        if (!ambientThenSafe()) return null;
        if (cookie === undefined) return null;
        const cookieRecord = exactDataRecord(cookie, AUTH_COOKIE_KEYS);
        if (!cookieRecord || cookieRecord.name !== SESSION_COOKIE_NAME
            || typeof cookieRecord.value !== 'string' || cookieRecord.value.length === 0) return null;
        const sessionId = cookieRecord.value;

        const session = resolveActiveWebServerSession(sessionId);
        if (!ambientThenSafe() || !session) return null;
        const sessionRecord = exactDataRecord(session, AUTH_SESSION_KEYS);
        if (!sessionRecord || sessionRecord.id !== sessionId
            || typeof sessionRecord.userId !== 'string' || sessionRecord.userId.length === 0
            || typeof sessionRecord.username !== 'string' || sessionRecord.username.length === 0
            || typeof sessionRecord.role !== 'string' || sessionRecord.role.length === 0
            || sessionRecord.authChannel !== 'web'
            || typeof sessionRecord.createdAt !== 'number' || !NumberIsFinite(sessionRecord.createdAt)
            || typeof sessionRecord.expiresAt !== 'number' || !NumberIsFinite(sessionRecord.expiresAt)
            || sessionRecord.expiresAt <= DateNow()) return null;

        const userIdPredicate = eq(users.id, sessionRecord.userId);
        if (!ambientThenSafe()) return null;
        const selected = dbServer.select({
            id: users.id,
            username: users.username,
            role: users.role,
        });
        if (!ambientThenSafe()) return null;
        const fromUsers = selected.from(users);
        if (!ambientThenSafe()) return null;
        const filtered = fromUsers.where(userIdPredicate);
        if (!ambientThenSafe()) return null;
        const user = filtered.get();
        if (!ambientThenSafe()) return null;
        if (!validatedUserAgreesWithActiveWebSession(user, sessionRecord)) {
            retireActiveWebSessionsForUser(sessionRecord.userId);
            if (!ambientThenSafe()) return null;
            return null;
        }

        const sessionValue = session as ServerSession;
        const owner = serverSessionProjectionOwnerRegistry.acquire(sessionValue);
        if (!ambientThenSafe() || !isProjectionOwner(owner)) return null;
        return authenticatedProjectionOwnerContext(sessionValue, owner);
    } catch {
        return null;
    }
}

/* @Codex */
export async function acquireAuthenticatedWebSessionProjectionOwner() {
    return (await acquireAuthenticatedWebSessionProjectionOwnerContext())?.owner ?? null;
}

/* @Codex */
function buildLocalApiSystemSession(): ServerSession {
    const now = Date.now();
    return {
        id: 'local-api',
        userId: 'local-api',
        username: 'local-api',
        role: 'admin',
        authChannel: 'system',
        createdAt: now,
        expiresAt: now + 1000 * 60 * 60,
    };
}

/* @Codex */
export async function requireSessionOrLocalToken(request: Request): Promise<ServerSession | null> {
    const session = await requireSession();
    if (session) return session;

    const tokenError = requireLocalApiToken(request);
    if (tokenError) return null;

    return buildLocalApiSystemSession();
}

/* @Codex */
export async function requireLocalApiActorSession(request: Request): Promise<ServerSession | null> {
    const tokenError = requireLocalApiToken(request);
    if (tokenError) return null;

    const session = await requireSession();
    if (session) {
        return {
            ...session,
            id: `native:${session.userId}`,
            authChannel: 'native',
        };
    }

    return buildLocalApiSystemSession();
}

export function unauthorizedResponse() {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function forbiddenResponse() {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
