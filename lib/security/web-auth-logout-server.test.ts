/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
    activateArmedWebServerSession, armPreparedWebServerSession, clearAllSessions,
    dispatchActiveWebServerSessionRetirement, getPreparedWebServerSessionId,
    prepareStagedWebServerSession, resolveActiveWebServerSession, stageWebServerSession,
} from './server-session';
import { createWebAuthControlRecord } from './web-auth-control-record';
import { completeExactWebP3Logout, type WebAuthLogoutSources } from './web-auth-logout-server';

const request = new Request('http://127.0.0.1/api/auth/logout', { method: 'POST' });
const SYNTHETIC_USERNAME = `synthetic-${randomUUID()}`;
const cookie = (value: unknown) => ({ name: 'mediflow_session', value });
const completed = Object.freeze(Object.assign(Object.create(null), { outcome: 'completed' as const }));
const denied = Object.freeze(Object.assign(Object.create(null), { outcome: 'denied' as const }));

function activate(userId = 'synthetic-logout-user') {
    const prepared = prepareStagedWebServerSession(stageWebServerSession({ id: userId, username: SYNTHETIC_USERNAME, role: 'clinician' })); assert.ok(prepared);
    const sessionId = getPreparedWebServerSessionId(prepared); assert.ok(sessionId);
    const port = armPreparedWebServerSession(prepared); assert.ok(port);
    const control = createWebAuthControlRecord('f0'); assert.equal(control.begin('login', 'op', 'key', 'fp', 0).ok, true);
    const ticket = control.prepareAuthControlTicket('f0', 'op', BigInt(0), 'fp', sessionId, 1); assert.ok(ticket);
    assert.equal(activateArmedWebServerSession(port, ticket), true);
    return { sessionId, session: resolveActiveWebServerSession(sessionId)! };
}

function sources(overrides: Partial<WebAuthLogoutSources> = {}): WebAuthLogoutSources {
    const exact = activate();
    return Object.freeze({
        resolve: () => exact.session,
        retire: () => completed,
        audit: async () => undefined,
        ...overrides,
    });
}

async function noUnhandled(action: () => Promise<unknown>) {
    const events: unknown[] = []; const listener = (reason: unknown) => events.push(reason); process.on('unhandledRejection', listener);
    try { const value = await action(); await new Promise<void>((resolve) => setImmediate(resolve)); return { value, events }; }
    finally { process.off('unhandledRejection', listener); }
}

afterEach(() => clearAllSessions());

test('retires only the exact ACTIVE Web P3 before audit and returns an empty no-store 204', async () => {
    const target = activate('target'); const other = activate('other'); const order: string[] = [];
    const response = await completeExactWebP3Logout(cookie(target.sessionId), request, Object.freeze({
        resolve: resolveActiveWebServerSession,
        retire: (id, reason) => { assert.equal(id, target.sessionId); assert.equal(reason, 'delete'); order.push('retire'); return dispatchActiveWebServerSessionRetirement(id, reason); },
        audit: async (session, id) => { order.push('audit'); assert.equal(session, target.session); assert.equal(id, target.sessionId); assert.equal(resolveActiveWebServerSession(id), null); },
    }));
    assert.equal(response.status, 204); assert.equal(await response.text(), ''); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null); assert.deepEqual(order, ['retire', 'audit']);
    assert.equal(resolveActiveWebServerSession(target.sessionId), null); assert.equal(resolveActiveWebServerSession(other.sessionId), other.session);
    assert.equal((await completeExactWebP3Logout(cookie(target.sessionId), request)).status, 401);
});

test('denies hostile cookie/session/receipt shapes without authority or observation', async () => {
    let traps = 0; let getters = 0; let resolves = 0; let retires = 0; let audits = 0;
    const proxy = new Proxy({ name: 'mediflow_session', value: 'a'.repeat(64) }, { get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); } });
    const accessor = { name: 'mediflow_session', value: 'a'.repeat(64) }; Object.defineProperty(accessor, 'value', { enumerable: true, get() { getters += 1; return 'a'.repeat(64); } });
    const base = sources({ resolve: () => { resolves += 1; return null; }, retire: () => { retires += 1; return completed; }, audit: async () => { audits += 1; } });
    for (const value of [undefined, null, {}, proxy, accessor, Promise.resolve(), { ...cookie('a'.repeat(64)), extra: true }, cookie('A'.repeat(64)), cookie('a'.repeat(63))]) {
        assert.equal((await completeExactWebP3Logout(value, request, base)).status, 401);
    }
    assert.deepEqual([traps, getters, resolves, retires, audits], [0, 0, 0, 0, 0]);

    const exact = activate(); const mutable = { ...exact.session }; const sessionAccessor = { ...exact.session };
    Object.defineProperty(sessionAccessor, 'role', { enumerable: true, get() { getters += 1; return 'clinician'; } });
    for (const value of [mutable, sessionAccessor, new Proxy(exact.session, { get() { traps += 1; throw new Error('trap'); } }), { ...exact.session, authChannel: 'native' }, { ...exact.session, authChannel: 'system' }]) {
        assert.equal((await completeExactWebP3Logout(cookie(exact.sessionId), request, sources({ resolve: () => value as never }))).status, 401);
    }
    assert.equal(traps, 0); assert.equal(getters, 0);

    for (const receipt of [denied, Object.freeze(Object.assign(Object.create(null), { outcome: 'failed' })), { outcome: 'completed' }, new Proxy(completed, {})]) {
        assert.equal((await completeExactWebP3Logout(cookie(exact.sessionId), request, sources({ resolve: () => exact.session, retire: () => receipt as never, audit: async () => { audits += 1; } }))).status, 409);
    }
    assert.equal(audits, 0);
});

test('audit failure is awaited, contained, and cannot change a completed retirement', async () => {
    for (const audit of [() => { throw new Error('audit throw'); }, async () => { throw new Error('audit rejection'); }, () => new Promise<void>((resolve) => setImmediate(resolve))]) {
        const exact = activate(); const observed = await noUnhandled(() => completeExactWebP3Logout(cookie(exact.sessionId), request, sources({
            resolve: () => exact.session,
            retire: dispatchActiveWebServerSessionRetirement,
            audit,
        })));
        assert.equal((observed.value as Response).status, 204); assert.deepEqual(observed.events, []); assert.equal(resolveActiveWebServerSession(exact.sessionId), null);
        clearAllSessions();
    }
});

test('route denies a rejected cookie Promise through the exact P3 logout server', () => {
    const route = readFileSync(new URL('../../app/api/auth/logout/route.ts', import.meta.url), 'utf8');
    assert.match(route, /let cookie: unknown = null/u); assert.equal(route.match(/cookies\(\)/gu)?.length, 1);
    assert.match(route, /try\s*\{[\s\S]*const cookieStore = await cookies\(\);[\s\S]*cookie = cookieStore\.get\(SESSION_COOKIE_NAME\);[\s\S]*\}\s*catch/u);
    assert.match(route, /return completeExactWebP3Logout\(cookie, request\);/u);
    const forbidden = ['requireSession', 'deleteSession', ['retireServerSession', 'ForLogout'].join(''),
        ['retireWebP3Sessions', 'ForUser'].join(''), 'clearAllSessions', 'cookies.set', 'cookies.delete', 'maxAge', 'Set-Cookie'];
    for (const token of forbidden) assert.equal(route.includes(token), false, token);

    const routeUrl = pathToFileURL(new URL('../../app/api/auth/logout/route.ts', import.meta.url).pathname).href;
    const toDataModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
    const program = `
        import { registerHooks } from 'node:module';
        const routeUrl = ${JSON.stringify(routeUrl)};
        const modules = new Map([
            ['next/headers', ${JSON.stringify(toDataModule("export const cookies = () => { globalThis.cookieCalls = (globalThis.cookieCalls ?? 0) + 1; return Promise.reject(new Error('synthetic rejection')); }"))}],
            ['@/lib/security/server-session', ${JSON.stringify(toDataModule("export const SESSION_COOKIE_NAME = 'mediflow_session';"))}],
            ['@/lib/security/web-auth-logout-server', ${JSON.stringify(toDataModule("export async function completeExactWebP3Logout(cookie) { globalThis.serviceCalls = (globalThis.serviceCalls ?? 0) + 1; globalThis.observedCookie = cookie; return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } }); }"))}],
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
        const observed = { status: response.status, body: await response.text(), cacheControl: response.headers.get('cache-control'), cookieCalls: globalThis.cookieCalls, serviceCalls: globalThis.serviceCalls, observedCookie: globalThis.observedCookie, unhandled };
        if (JSON.stringify(observed) !== JSON.stringify({ status: 401, body: '', cacheControl: 'no-store', cookieCalls: 1, serviceCalls: 1, observedCookie: null, unhandled: 0 })) process.exitCode = 1;
    `;
    const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', program], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr || child.stdout);
});
