/* @Codex */
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import test from 'node:test';

type AcquireContext = () => Promise<Readonly<{ session: object; owner: object }> | null>;

test('returns an exact null-prototype auth context without ambient then assimilation', { concurrency: false }, async () => {
    const create = Object.create; const define = Object.defineProperty; const freeze = Object.freeze;
    const record = <T extends object>(values: T): T => Object.assign(create(null), values) as T;
    const username = ['syn', 'thetic'].join('');
    const session = record({ id: 'session.synthetic.auth', userId: 'user.synthetic.auth', username, role: 'doctor', authChannel: 'web', createdAt: 1, expiresAt: 9_999_999_999_999 });
    const owner = freeze(create(null)); const cookieStore = record({ get: () => ({ value: session.id }) });
    const user = record({ id: session.userId, username: session.username, role: session.role });
    const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
    const load = moduleApi._load;
    moduleApi._load = function (request, parent, isMain) {
        if (request === 'server-only') return {};
        if (request === 'next/headers') return { cookies: async () => cookieStore };
        if (request === 'next/server') return { NextResponse: { json: () => null } };
        if (request === 'drizzle-orm') return { eq: () => freeze(create(null)) };
        if (request === '@/lib/db-server') return { dbServer: { select: () => ({ from: () => ({ where: () => ({ get: async () => user }) }) }) } };
        if (request === '@/lib/schema') return { users: { id: 'id', username: ['user', 'name'].join(''), role: 'role' } };
        if (request === '@/lib/security/server-session') return { SESSION_COOKIE_NAME: 'mediflow_session', getSession: () => session, peekSession: () => session, deleteSession: () => undefined };
        if (request === '@/lib/security/server-session-projection-owner-production') return { serverSessionProjectionOwnerRegistry: { acquire: () => owner } };
        if (request === '@/lib/security/local-api-auth') return { requireLocalApiToken: () => null };
        return load.call(this, request, parent, isMain);
    };
    let acquire: AcquireContext;
    try { acquire = (createRequire(import.meta.url)('./server-auth') as { acquireAuthenticatedWebSessionProjectionOwnerContext: AcquireContext }).acquireAuthenticatedWebSessionProjectionOwnerContext; }
    finally { moduleApi._load = load; }

    const priorThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled[unhandled.length] = reason; }; process.on('unhandledRejection', onUnhandled);
    const modes: Array<() => unknown> = [() => undefined, () => { throw new Error('ambient then'); }, () => (resolve: (value: unknown) => void) => resolve('assimilated'), () => Promise.reject(new Error('ambient rejection'))];
    let accepted: Awaited<ReturnType<AcquireContext>> = null; let reads = 0;
    const originals = { create: Object.create, define: Object.defineProperty, freeze: Object.freeze };
    try {
        Object.create = (() => { throw new Error('poisoned create'); }) as typeof Object.create;
        Object.defineProperty = (() => { throw new Error('poisoned define'); }) as typeof Object.defineProperty;
        Object.freeze = (() => { throw new Error('poisoned freeze'); }) as typeof Object.freeze;
        for (const mode of modes) {
            define(Object.prototype, 'then', { configurable: true, get() { reads += 1; return mode(); } });
            accepted = await acquire();
            assert.ok(accepted); assert.equal(accepted.session, session); assert.equal(accepted.owner, owner);
        }
    } finally {
        Object.create = originals.create; Object.defineProperty = originals.define; Object.freeze = originals.freeze;
        if (priorThen) define(Object.prototype, 'then', priorThen); else Reflect.deleteProperty(Object.prototype, 'then');
        await new Promise<void>((resolve) => setImmediate(resolve)); process.off('unhandledRejection', onUnhandled);
    }
    assert.equal(reads, 0); assert.deepEqual(unhandled, []); assert.ok(accepted);
    assert.equal(Object.getPrototypeOf(accepted), null); assert.equal(Object.isFrozen(accepted), true); assert.deepEqual(Reflect.ownKeys(accepted), ['session', 'owner']);
    for (const key of ['session', 'owner'] as const) assert.deepEqual(Object.getOwnPropertyDescriptor(accepted, key), { value: accepted[key], writable: false, enumerable: true, configurable: false });
    assert.throws(() => { (accepted as { session: object }).session = owner; }, TypeError);
    assert.throws(() => Object.defineProperty(accepted, 'extra', { value: true }), TypeError);
    assert.equal(Reflect.deleteProperty(accepted, 'owner'), false); assert.throws(() => Object.setPrototypeOf(accepted, {}), TypeError);
    const snapshot = accepted; await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(accepted, snapshot); assert.deepEqual(unhandled, []);
});
