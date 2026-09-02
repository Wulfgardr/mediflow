/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
    completeExactWebP3Logout,
    type WebAuthLogoutSources,
} from './web-auth-logout-server';
import type {
    WebRetirementReceipt,
    WebSessionProjection,
    WebSessionResolution,
} from './web-auth-lifecycle-owner-adapter';

const request = new Request('http://127.0.0.1/api/auth/logout', { method: 'POST' });
const SESSION_ID = 'a'.repeat(64);
const CONTROL_ID = 'c'.repeat(64);
const ETAG = 'e'.repeat(64);
const bearerCookie = (value: unknown) => ({ name: 'mediflow_session', value });
const controlCookie = (value: unknown) => ({ name: 'mediflow_auth_control', value });

function sealed<Value extends Record<string, unknown>>(values: Value): Readonly<Value> {
    return Object.freeze(Object.assign(Object.create(null), values)) as Readonly<Value>;
}

function projection(overrides: Partial<WebSessionProjection> = {}): WebSessionProjection {
    return sealed({
        id: SESSION_ID,
        userId: 'synthetic-logout-user',
        username: 'synthetic-logout-operator',
        role: 'clinician',
        authChannel: 'web' as const,
        createdAt: 1,
        expiresAt: 9_999_999_999_999,
        ...overrides,
    });
}

function active(value = projection()): WebSessionResolution {
    return sealed({ status: 'active' as const, projection: value });
}

function receipt(outcome: 'completed' | 'denied' | 'failed', etag?: string): WebRetirementReceipt {
    return etag === undefined ? sealed({ outcome }) : sealed({ outcome, etag });
}

function sources(overrides: Partial<WebAuthLogoutSources> = {}): WebAuthLogoutSources {
    const exact = projection();
    return Object.freeze({
        resolve: () => active(exact),
        retire: () => receipt('completed'),
        audit: async () => undefined,
        ...overrides,
    });
}

async function noUnhandled(action: () => Promise<unknown>) {
    const events: unknown[] = [];
    const listener = (reason: unknown) => events.push(reason);
    process.on('unhandledRejection', listener);
    try {
        const value = await action();
        await new Promise<void>((resolve) => setImmediate(resolve));
        return { value, events };
    } finally {
        process.off('unhandledRejection', listener);
    }
}

test('retires the exact projection bound to bearer and control before audit', async () => {
    const exact = projection();
    const order: string[] = [];
    const response = await completeExactWebP3Logout(
        bearerCookie(SESSION_ID),
        controlCookie(CONTROL_ID),
        request,
        Object.freeze({
            resolve: (sessionId, controlId) => {
                assert.equal(sessionId, SESSION_ID);
                assert.equal(controlId, CONTROL_ID);
                return active(exact);
            },
            retire: (presented, reason) => {
                assert.equal(presented, exact);
                assert.equal(reason, 'delete');
                order.push('retire');
                return receipt('completed', ETAG);
            },
            audit: async (session, id) => {
                order.push('audit');
                assert.equal(session, exact);
                assert.equal(id, SESSION_ID);
            },
        }),
    );
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('etag'), `"${ETAG}"`);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(order, ['retire', 'audit']);
});

test('denies hostile or missing cookies before owner resolution', async () => {
    let traps = 0;
    let getters = 0;
    let resolves = 0;
    const proxy = new Proxy({ name: 'mediflow_session', value: SESSION_ID }, {
        get() { traps += 1; throw new Error('trap'); },
        ownKeys() { traps += 1; throw new Error('trap'); },
    });
    const accessor = { name: 'mediflow_session', value: SESSION_ID };
    Object.defineProperty(accessor, 'value', { enumerable: true, get() { getters += 1; return SESSION_ID; } });
    const exactSources = sources({ resolve: () => { resolves += 1; return sealed({ status: 'absent' as const }); } });
    const invalidBearers = [undefined, null, {}, proxy, accessor, Promise.resolve(),
        { ...bearerCookie(SESSION_ID), extra: true }, bearerCookie('A'.repeat(64)), bearerCookie('a'.repeat(63))];
    for (const value of invalidBearers) {
        assert.equal((await completeExactWebP3Logout(value, controlCookie(CONTROL_ID), request, exactSources)).status, 401);
    }
    for (const value of [undefined, controlCookie('short'), bearerCookie(CONTROL_ID),
        { ...controlCookie(CONTROL_ID), extra: true }]) {
        assert.equal((await completeExactWebP3Logout(bearerCookie(SESSION_ID), value, request, exactSources)).status, 401);
    }
    assert.deepEqual([traps, getters, resolves], [0, 0, 0]);
});

test('accepts only an exact active owner resolution and exact retirement receipt', async () => {
    let retires = 0;
    let audits = 0;
    const deniedSources = sources({
        retire: () => { retires += 1; return receipt('completed'); },
        audit: async () => { audits += 1; },
    });
    const deniedResolutions: unknown[] = [
        sealed({ status: 'absent' as const }),
        sealed({ status: 'owned_denied' as const }),
        { status: 'active', projection: projection() },
        sealed({ status: 'active' as const, projection: { ...projection() } }),
        sealed({ status: 'active' as const, projection: projection({ id: 'b'.repeat(64) }) }),
        sealed({ status: 'active' as const, projection: projection({ expiresAt: 0 }) }),
    ];
    for (const resolution of deniedResolutions) {
        const response = await completeExactWebP3Logout(
            bearerCookie(SESSION_ID), controlCookie(CONTROL_ID), request,
            sources({ ...deniedSources, resolve: () => resolution as WebSessionResolution }),
        );
        assert.equal(response.status, 401);
    }
    assert.deepEqual([retires, audits], [0, 0]);

    const exact = projection();
    for (const invalid of [
        receipt('denied'),
        receipt('failed', ETAG),
        { outcome: 'completed' },
        sealed({ outcome: 'completed', etag: 'short' }),
        new Proxy(receipt('completed'), {}),
    ]) {
        const response = await completeExactWebP3Logout(
            bearerCookie(SESSION_ID), controlCookie(CONTROL_ID), request,
            sources({ resolve: () => active(exact), retire: () => invalid as WebRetirementReceipt, audit: async () => { audits += 1; } }),
        );
        assert.equal(response.status, 409);
        if (invalid === undefined) assert.equal(response.headers.get('etag'), null);
    }
    assert.equal(audits, 0);
});

test('audit failure is awaited and cannot change terminal retirement', async () => {
    for (const audit of [
        () => { throw new Error('audit throw'); },
        async () => { throw new Error('audit rejection'); },
        () => new Promise<void>((resolve) => setImmediate(resolve)),
    ]) {
        const observed = await noUnhandled(() => completeExactWebP3Logout(
            bearerCookie(SESSION_ID), controlCookie(CONTROL_ID), request,
            sources({ audit }),
        ));
        assert.equal((observed.value as Response).status, 204);
        assert.deepEqual(observed.events, []);
    }
});

test('route reads both cookies once and denies a rejected cookie Promise', () => {
    const route = readFileSync(new URL('../../app/api/auth/logout/route.ts', import.meta.url), 'utf8');
    assert.equal(route.match(/cookies\(\)/gu)?.length, 1);
    assert.match(route, /bearerCookie = cookieStore\.get\(SESSION_COOKIE_NAME\)/u);
    assert.match(route, /controlCookie = cookieStore\.get\(CONTROL_COOKIE_NAME\)/u);
    assert.match(route, /completeExactWebP3Logout\(bearerCookie, controlCookie, request\)/u);
    const forbidden = ['requireSession', 'server-session', 'deleteSession', 'clearAllSessions',
        'cookies.set', 'cookies.delete', 'maxAge', 'Set-Cookie'];
    for (const token of forbidden) assert.equal(route.includes(token), false, token);

    const routeUrl = pathToFileURL(new URL('../../app/api/auth/logout/route.ts', import.meta.url).pathname).href;
    const toDataModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
    const program = `
        import { registerHooks } from 'node:module';
        const routeUrl = ${JSON.stringify(routeUrl)};
        const modules = new Map([
            ['next/headers', ${JSON.stringify(toDataModule("export const cookies = () => { globalThis.cookieCalls = (globalThis.cookieCalls ?? 0) + 1; return Promise.reject(new Error('synthetic rejection')); }"))}],
            ['@/lib/security/web-auth-logout-server', ${JSON.stringify(toDataModule("export async function completeExactWebP3Logout(bearer, control) { globalThis.serviceCalls = (globalThis.serviceCalls ?? 0) + 1; globalThis.observed = [bearer, control]; return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } }); }"))}],
            ['@/lib/security/portable-supervisor-web-lifecycle', ${JSON.stringify(toDataModule("export async function completePortableSupervisorWebLifecycleMutationV1(mutation) { return mutation; }"))}],
        ]);
        registerHooks({ resolve(specifier, context, nextResolve) {
            if (context.parentURL === routeUrl && modules.has(specifier)) return { shortCircuit: true, url: modules.get(specifier), format: 'module' };
            return nextResolve(specifier, context);
        } });
        let unhandled = 0;
        process.on('unhandledRejection', () => { unhandled += 1; });
        const { POST } = await import(routeUrl);
        const response = await POST(new Request('http://127.0.0.1/api/auth/logout', { method: 'POST' }));
        await new Promise((resolve) => setImmediate(resolve));
        const observed = { status: response.status, body: await response.text(), cacheControl: response.headers.get('cache-control'), cookieCalls: globalThis.cookieCalls, serviceCalls: globalThis.serviceCalls, cookies: globalThis.observed, unhandled };
        if (JSON.stringify(observed) !== JSON.stringify({ status: 401, body: '', cacheControl: 'no-store', cookieCalls: 1, serviceCalls: 1, cookies: [null, null], unhandled: 0 })) process.exitCode = 1;
    `;
    const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', program], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr || child.stdout);
});
