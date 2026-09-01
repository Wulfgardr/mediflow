/* @Codex */
import 'server-only';

import { types } from 'node:util';

const SESSION_KEYS = ['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt'] as const;
const objectCreate = Object.create, objectAssign = Object.assign, objectFreeze = Object.freeze;
const objectGetPrototypeOf = Object.getPrototypeOf, objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectIsFrozen = Object.isFrozen, objectPrototype = Object.prototype, reflectOwnKeys = Reflect.ownKeys;
const numberIsSafeInteger = Number.isSafeInteger, reflectApply = Reflect.apply;
const regexpTest = RegExp.prototype.test, stringTrim = String.prototype.trim, dateNow = Date.now;
const isProxy = types.isProxy, isPromise = types.isPromise, sessionIdPattern = /^[0-9a-f]{64}$/u;
const promisePrototype = Promise.prototype, promiseThen = Promise.prototype.then;
const promiseConstructor = Promise;
const promiseConstructorDescriptor = objectGetOwnPropertyDescriptor(promisePrototype, 'constructor');
const promiseThenDescriptor = objectGetOwnPropertyDescriptor(promisePrototype, 'then');

export type HeadlessSoapFreshPinVerificationSources = Readonly<{
    resolveCurrentWebAdmin(): Promise<unknown>;
    verifyCredentials(input: unknown): Promise<unknown>;
}>;

export type HeadlessSoapFreshPinVerificationV1 = Readonly<{
    id: string;
    userId: string;
    username: string;
    role: 'admin';
    authChannel: 'web';
    createdAt: number;
    expiresAt: number;
}>;

export type HeadlessSoapFreshPinVerifier = Readonly<{
    verify(candidatePin: unknown): Promise<HeadlessSoapFreshPinVerificationV1 | null>;
}>;

function ambientThenSafe(): boolean {
    try {
        const constructor = objectGetOwnPropertyDescriptor(promisePrototype, 'constructor');
        const then = objectGetOwnPropertyDescriptor(promisePrototype, 'then');
        return objectGetOwnPropertyDescriptor(objectPrototype, 'then') === undefined
            && !!constructor && !!promiseConstructorDescriptor && 'value' in constructor && 'value' in promiseConstructorDescriptor
            && constructor.value === promiseConstructor && constructor.enumerable === promiseConstructorDescriptor.enumerable
            && constructor.configurable === promiseConstructorDescriptor.configurable
            && constructor.writable === promiseConstructorDescriptor.writable
            && !!then && !!promiseThenDescriptor && 'value' in then && 'value' in promiseThenDescriptor
            && then.value === promiseThen && then.enumerable === promiseThenDescriptor.enumerable
            && then.configurable === promiseThenDescriptor.configurable && then.writable === promiseThenDescriptor.writable;
    } catch { return false; }
}

function brandedNativePromise(value: unknown): value is Promise<unknown> {
    try {
        return typeof value === 'object' && value !== null && !isProxy(value) && isPromise(value)
            && objectGetPrototypeOf(value) === promisePrototype;
    } catch { return false; }
}

function exactNativePromise(value: unknown): value is Promise<unknown> {
    if (!brandedNativePromise(value)) return false;
    try {
        const keys = reflectOwnKeys(value);
        for (let index = 0; index < keys.length; index += 1) if (typeof keys[index] === 'string') return false;
        return true;
    } catch { return false; }
}

function discard(value: Promise<unknown>): void {
    try { reflectApply(promiseThen, value, [() => undefined, () => undefined]); } catch { /* denial remains local */ }
}

function exactRecord(
    value: unknown,
    keys: readonly string[],
    prototype: object | null,
    frozen = false,
): Record<string, unknown> | null {
    try {
        if (
            typeof value !== 'object'
            || value === null
            || isProxy(value)
            || objectGetPrototypeOf(value) !== prototype
            || (frozen && !objectIsFrozen(value))
        ) return null;
        const ownKeys = reflectOwnKeys(value);
        if (ownKeys.length !== keys.length) return null;
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index]!;
            const descriptor = objectGetOwnPropertyDescriptor(value, key);
            if (
                !descriptor
                || !descriptor.enumerable
                || !('value' in descriptor)
                || (frozen && (descriptor.configurable || descriptor.writable))
            ) return null;
        }
        return value as Record<string, unknown>;
    } catch {
        return null;
    }
}

function currentWebAdmin(value: unknown, now: number): Record<string, unknown> | null {
    const record = exactRecord(value, SESSION_KEYS, null, true);
    if (
        !record
        || typeof record.id !== 'string'
        || !reflectApply(regexpTest, sessionIdPattern, [record.id])
        || typeof record.userId !== 'string'
        || !record.userId
        || reflectApply(stringTrim, record.userId, []) !== record.userId
        || record.userId.length > 256
        || typeof record.username !== 'string'
        || !record.username
        || reflectApply(stringTrim, record.username, []) !== record.username
        || record.role !== 'admin'
        || record.authChannel !== 'web'
        || !numberIsSafeInteger(record.createdAt)
        || !numberIsSafeInteger(record.expiresAt)
        || (record.createdAt as number) < 0
        || (record.createdAt as number) > now
        || (record.expiresAt as number) <= now
    ) return null;
    return record;
}

function coherentVerifiedAccount(value: unknown, current: Record<string, unknown>): boolean {
    try {
        const verification = exactRecord(value, ['kind', 'account'], objectPrototype);
        if (!verification || verification.kind !== 'verified') return false;
        const account = verification.account;
        if (
            typeof account !== 'object'
            || account === null
            || isProxy(account)
            || objectGetPrototypeOf(account) !== objectPrototype
        ) return false;
        const descriptors = objectCreate(null) as Record<string, PropertyDescriptor>;
        const accountKeys = ['id', 'username', 'role'] as const;
        for (let index = 0; index < accountKeys.length; index += 1) {
            const key = accountKeys[index]!;
            const descriptor = objectGetOwnPropertyDescriptor(account, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false;
            descriptors[key] = descriptor;
        }
        return descriptors.id.value === current.userId
            && descriptors.username.value === current.username
            && descriptors.role.value === 'admin';
    } catch {
        return false;
    }
}

function sameSession(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
    for (let index = 0; index < SESSION_KEYS.length; index += 1) {
        const key = SESSION_KEYS[index]!; if (before[key] !== after[key]) return false;
    }
    return true;
}

function snapshot(record: Record<string, unknown>): HeadlessSoapFreshPinVerificationV1 {
    return objectFreeze(objectAssign(objectCreate(null), {
        id: record.id,
        userId: record.userId,
        username: record.username,
        role: 'admin' as const,
        authChannel: 'web' as const,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
    })) as HeadlessSoapFreshPinVerificationV1;
}

export function isHeadlessSoapFreshPinVerificationV1(
    value: unknown,
): value is HeadlessSoapFreshPinVerificationV1 {
    return currentWebAdmin(value, dateNow()) !== null;
}

/** Verifies a fresh PIN against one unchanged host-resolved Web admin session. */
export function createHeadlessSoapFreshPinVerifier(
    sources: HeadlessSoapFreshPinVerificationSources,
): HeadlessSoapFreshPinVerifier {
    async function verify(candidatePin: unknown): Promise<HeadlessSoapFreshPinVerificationV1 | null> {
        if (!ambientThenSafe() || typeof candidatePin !== 'string' || candidatePin.length < 4 || candidatePin.length > 8) return null;
        try {
            const beforePending = sources.resolveCurrentWebAdmin();
            if (!ambientThenSafe() || !exactNativePromise(beforePending)) {
                if (brandedNativePromise(beforePending)) discard(beforePending); return null;
            }
            const before = currentWebAdmin(await beforePending, dateNow());
            if (!ambientThenSafe()) return null;
            if (!before) return null;
            const verificationPending = sources.verifyCredentials({ username: before.username, pin: candidatePin });
            if (!ambientThenSafe() || !exactNativePromise(verificationPending)) {
                if (brandedNativePromise(verificationPending)) discard(verificationPending); return null;
            }
            const verification = await verificationPending;
            if (!ambientThenSafe()) return null;
            if (!coherentVerifiedAccount(verification, before)) return null;
            const afterPending = sources.resolveCurrentWebAdmin();
            if (!ambientThenSafe() || !exactNativePromise(afterPending)) {
                if (brandedNativePromise(afterPending)) discard(afterPending); return null;
            }
            const after = currentWebAdmin(await afterPending, dateNow());
            if (!ambientThenSafe()) return null;
            return after && sameSession(before, after) ? snapshot(after) : null;
        } catch {
            return null;
        }
    }

    return objectFreeze(objectAssign(objectCreate(null), { verify })) as HeadlessSoapFreshPinVerifier;
}
