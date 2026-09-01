/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import {
    createHeadlessSoapFreshPinVerifier,
    type HeadlessSoapFreshPinVerificationSources,
} from './headless-soap-fresh-pin-verification.ts';

const PIN = '2468';
const USER_ID = 'synthetic-fresh-pin-user';
const USERNAME = 'synthetic-fresh-pin-admin';
const SESSION_ID = 'a'.repeat(64);
const NOW = Math.floor(Date.now() / 1_000) * 1_000;
const baseSession = {
    id: SESSION_ID,
    userId: USER_ID,
    username: USERNAME,
    role: 'admin',
    authChannel: 'web',
    createdAt: NOW - 1_000,
    expiresAt: NOW + 60_000,
};

function session(change: Record<string, unknown> = {}): unknown {
    return Object.freeze(Object.assign(Object.create(null), baseSession, change));
}

function sources(
    overrides: Partial<HeadlessSoapFreshPinVerificationSources> = {},
): HeadlessSoapFreshPinVerificationSources {
    return {
        resolveCurrentWebAdmin: async () => session(),
        verifyCredentials: async () => ({
            kind: 'verified',
            account: {
                id: USER_ID,
                username: USERNAME,
                role: 'admin',
                displayName: 'Synthetic Admin',
                encryptedMasterKey: 'synthetic-only',
            },
        }),
        ...overrides,
    };
}

test('verifies the fresh PIN only for the same current Web admin session', async () => {
    const trace: string[] = [];
    const verifier = createHeadlessSoapFreshPinVerifier({
        async resolveCurrentWebAdmin() {
            trace.push(trace.length === 0 ? 'resolve-before' : 'resolve-after');
            return session();
        },
        async verifyCredentials(input) {
            trace.push('verify');
            assert.deepEqual(input, { username: USERNAME, pin: PIN });
            assert.deepEqual(Reflect.ownKeys(input as object), ['username', 'pin']);
            return { kind: 'verified', account: { id: USER_ID, username: USERNAME, role: 'admin' } };
        },
    });

    const verified = await verifier.verify(PIN);
    assert.ok(verified);
    assert.equal(Object.getPrototypeOf(verified), null);
    assert.equal(Object.isFrozen(verified), true);
    assert.deepEqual(Reflect.ownKeys(verified), [
        'id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt',
    ]);
    assert.deepEqual({ ...verified }, baseSession);
    assert.deepEqual(trace, ['resolve-before', 'verify', 'resolve-after']);
    assert.deepEqual(Reflect.ownKeys(verifier), ['verify']);
    assert.equal(Object.getPrototypeOf(verifier), null);
    assert.equal(Object.isFrozen(verifier), true);
    assert.equal(verifier.verify.length, 1);
});

test('preserves a valid PIN byte-for-byte and rejects values outside the exact 4..8 string boundary', async () => {
    const exactPin = ' 12 ';
    let observed: unknown;
    const verifier = createHeadlessSoapFreshPinVerifier(sources({
        verifyCredentials: async (input) => {
            observed = input;
            return { kind: 'verified', account: { id: USER_ID, username: USERNAME, role: 'admin' } };
        },
    }));
    assert.ok(await verifier.verify(exactPin));
    assert.deepEqual(observed, { username: USERNAME, pin: exactPin });

    for (const invalidPin of [undefined, null, 2468, '', '123', '123456789']) {
        let resolves = 0;
        const rejectingVerifier = createHeadlessSoapFreshPinVerifier(sources({
            resolveCurrentWebAdmin: async () => { resolves++; return session(); },
        }));
        assert.equal(await rejectingVerifier.verify(invalidPin), null);
        assert.equal(resolves, 0);
    }
});

test('fails closed for malformed Web admin projections and dependency throws', async () => {
    const unfrozen = Object.assign(Object.create(null), baseSession);
    const accessor = Object.assign(Object.create(null), baseSession);
    Object.defineProperty(accessor, 'username', {
        configurable: true,
        enumerable: true,
        get() { throw new Error('synthetic accessor must not run'); },
    });
    Object.freeze(accessor);
    const symbol = Symbol('synthetic-extra');
    const malformed = [
        null,
        Object.freeze({ ...baseSession }),
        unfrozen,
        session({ extra: true }),
        Object.freeze(Object.assign(Object.create(null), baseSession, { [symbol]: true })),
        accessor,
        session({ id: 'not-a-session-id' }),
        session({ userId: '' }),
        session({ userId: ` ${USER_ID}` }),
        session({ username: '' }),
        session({ username: `${USERNAME} ` }),
        session({ role: 'doctor' }),
        session({ authChannel: 'native' }),
        session({ createdAt: -1 }),
        session({ createdAt: NOW + 60_000 }),
        session({ expiresAt: NOW }),
        session({ expiresAt: Number.MAX_SAFE_INTEGER + 1 }),
    ];
    for (const projection of malformed) {
        let credentialCalls = 0;
        const verifier = createHeadlessSoapFreshPinVerifier(sources({
            resolveCurrentWebAdmin: async () => projection,
            verifyCredentials: async () => { credentialCalls++; return { kind: 'denied' }; },
        }));
        assert.equal(await verifier.verify(PIN), null);
        assert.equal(credentialCalls, 0);
    }

    assert.equal(await createHeadlessSoapFreshPinVerifier(sources({
        resolveCurrentWebAdmin: async () => { throw new Error('synthetic resolve failure'); },
    })).verify(PIN), null);
    assert.equal(await createHeadlessSoapFreshPinVerifier(sources({
        verifyCredentials: async () => { throw new Error('synthetic credential failure'); },
    })).verify(PIN), null);
    let resolves = 0;
    assert.equal(await createHeadlessSoapFreshPinVerifier(sources({
        resolveCurrentWebAdmin: async () => {
            resolves++;
            if (resolves === 2) throw new Error('synthetic final resolve failure');
            return session();
        },
    })).verify(PIN), null);
});

test('requires an exact verified result whose host account matches the first session', async () => {
    const malformedResults: unknown[] = [
        null,
        { kind: 'denied' },
        { kind: 'verified' },
        { kind: 'verified', account: null },
        { kind: 'verified', account: { id: 'other', username: USERNAME, role: 'admin' } },
        { kind: 'verified', account: { id: USER_ID, username: 'other', role: 'admin' } },
        { kind: 'verified', account: { id: USER_ID, username: USERNAME, role: 'doctor' } },
        { kind: 'verified', account: { id: USER_ID, username: USERNAME, role: 'admin' }, extra: true },
        new Proxy({ kind: 'verified', account: { id: USER_ID, username: USERNAME, role: 'admin' } }, {}),
    ];
    for (const result of malformedResults) {
        let resolves = 0;
        const verifier = createHeadlessSoapFreshPinVerifier(sources({
            resolveCurrentWebAdmin: async () => { resolves++; return session(); },
            verifyCredentials: async () => result,
        }));
        assert.equal(await verifier.verify(PIN), null);
        assert.equal(resolves, 1);
    }
});

test('rejects drift in every field of the exact Web session projection', async () => {
    const drifts = [
        { id: 'b'.repeat(64) },
        { userId: 'synthetic-other-user' },
        { username: 'synthetic-other-admin' },
        { role: 'doctor' },
        { authChannel: 'native' },
        { createdAt: NOW - 2_000 },
        { expiresAt: NOW + 120_000 },
    ];
    for (const drift of drifts) {
        let resolves = 0;
        const verifier = createHeadlessSoapFreshPinVerifier(sources({
            resolveCurrentWebAdmin: async () => (++resolves === 1 ? session() : session(drift)),
        }));
        assert.equal(await verifier.verify(PIN), null);
        assert.equal(resolves, 2);
    }
});

test('does not inherit forged account descriptors from Object.prototype', async () => {
    const keys = ['id', 'username', 'role'] as const;
    const originals = keys.map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key));
    const verifier = createHeadlessSoapFreshPinVerifier(sources({
        verifyCredentials: async () => {
            Object.defineProperties(Object.prototype, {
                id: { configurable: true, value: { enumerable: true, value: USER_ID } },
                username: { configurable: true, value: { enumerable: true, value: USERNAME } },
                role: { configurable: true, value: { enumerable: true, value: 'admin' } },
            });
            return { kind: 'verified', account: { alienA: 1, alienB: 2, alienC: 3 } };
        },
    }));
    let accepted: unknown = true;
    try {
        accepted = await verifier.verify(PIN);
    } finally {
        keys.forEach((key, index) => {
            const descriptor = originals[index];
            if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
            else delete (Object.prototype as Record<string, unknown>)[key];
        });
    }
    assert.equal(accepted, null);
});

test('does not accept session drift after Array iteration is poisoned by the credential source', async () => {
    const originalIterator = Array.prototype[Symbol.iterator]; let resolves = 0, accepted: unknown = true;
    const verifier = createHeadlessSoapFreshPinVerifier(sources({
        resolveCurrentWebAdmin: async () => (++resolves === 1 ? session() : session({
            id: 'b'.repeat(64), userId: 'synthetic-other-user', username: 'synthetic-other-admin',
        })),
        verifyCredentials: async () => {
            Array.prototype[Symbol.iterator] = function* emptyIterator(): Generator<never, undefined, unknown> { return undefined; };
            return { kind: 'verified', account: { id: USER_ID, username: USERNAME, role: 'admin' } };
        },
    }));
    try {
        accepted = await verifier.verify(PIN);
    } finally {
        Array.prototype[Symbol.iterator] = originalIterator;
    }
    assert.equal(accepted, null);
});

test('rejects ambient then poisoning before it can rewrite a denied credential Promise result', async () => {
    const originalThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    let credentialCalls = 0, receiverKeys: PropertyKey[] = [];
    const verifier = createHeadlessSoapFreshPinVerifier(sources({
        resolveCurrentWebAdmin: async () => {
            Object.defineProperty(Object.prototype, 'then', {
                configurable: true,
                value(this: object, resolve: (value: unknown) => void) {
                    receiverKeys = Reflect.ownKeys(this);
                    delete (Object.prototype as Record<string, unknown>).then;
                    resolve({ kind: 'verified', account: { id: USER_ID, username: USERNAME, role: 'admin' } });
                },
            });
            return session();
        },
        verifyCredentials: async () => { credentialCalls++; return { kind: 'denied' }; },
    }));
    let verified: unknown;
    try {
        verified = await verifier.verify(PIN);
    } finally {
        if (originalThen) Object.defineProperty(Object.prototype, 'then', originalThen);
        else delete (Object.prototype as Record<string, unknown>).then;
    }
    assert.equal(verified, null);
    assert.equal(credentialCalls, 0);
    assert.deepEqual(receiverKeys, []);
});

test('rejects a branded native Promise with own constructor and then overrides', async () => {
    const verifier = createHeadlessSoapFreshPinVerifier(sources({
        verifyCredentials: () => {
            const pending = Promise.resolve({ kind: 'denied' });
            Object.defineProperties(pending, {
                constructor: { configurable: true, value: Object },
                then: {
                    configurable: true,
                    value(resolve: (value: unknown) => void) {
                        resolve({ kind: 'verified', account: { id: USER_ID, username: USERNAME, role: 'admin' } });
                    },
                },
            });
            return pending;
        },
    }));
    assert.equal(await verifier.verify(PIN), null);
});

test('rejects Promise prototype poisoning introduced synchronously by a source callout', async () => {
    const constructorDescriptor = Object.getOwnPropertyDescriptor(Promise.prototype, 'constructor');
    const thenDescriptor = Object.getOwnPropertyDescriptor(Promise.prototype, 'then');
    assert.ok(constructorDescriptor && thenDescriptor);
    const labels = new WeakMap<object, 'before' | 'verify'>(); let resolves = 0;
    const restore = () => {
        Object.defineProperty(Promise.prototype, 'constructor', constructorDescriptor);
        Object.defineProperty(Promise.prototype, 'then', thenDescriptor);
    };
    const poisonThen = function(this: object, onFulfilled: (value: unknown) => void) {
        const label = labels.get(this);
        if (label === 'before') { onFulfilled(session()); return; }
        if (label === 'verify') {
            onFulfilled({ kind: 'verified', account: { id: USER_ID, username: USERNAME, role: 'admin' } }); return;
        }
        restore(); onFulfilled(null);
    };
    const verifier = createHeadlessSoapFreshPinVerifier(sources({
        resolveCurrentWebAdmin: () => {
            resolves++;
            const pending = Promise.resolve(session());
            if (resolves === 1) {
                labels.set(pending, 'before');
                Object.defineProperties(Promise.prototype, {
                    constructor: { configurable: true, value: Object },
                    then: { configurable: true, value: poisonThen },
                });
            } else restore();
            return pending;
        },
        verifyCredentials: () => {
            const pending = Promise.resolve({ kind: 'denied' }); labels.set(pending, 'verify'); return pending;
        },
    }));
    let verified: unknown;
    try {
        verified = await verifier.verify(PIN);
    } finally {
        restore();
    }
    assert.equal(verified, null);
    assert.equal(resolves, 1);
});

test('keeps fresh PIN verification server-only and free of transport, storage, and review authority imports', () => {
    const source = fs.readFileSync(new URL('./headless-soap-fresh-pin-verification.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/(?:from\s+|import\s+)['"]([^'"]+)['"]/gu)].map((match) => match[1]).sort();
    assert.deepEqual(imports, ['node:util', 'server-only']);
    assert.doesNotMatch(source, /physician[_-]terminal[_-]review|fresh[_-]review|review[_-]authority|db-server|drizzle|audit|route|persist/iu);
});
