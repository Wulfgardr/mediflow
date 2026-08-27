/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createNativeLoginHttpHandler } from './native-login-http.ts';
import {
    clearAllSessions,
    createNativeServerSession,
    createSession,
    getSession,
    isPairedNativeServerSession,
} from './server-session.ts';

const pin = ['2', '4', '6', '8'].join(''); const wrongPin = ['w', 'r', 'o', 'n', 'g'].join('');
const user = Object.freeze({ id: 'user.synthetic.native', username: ['native', 'user'].join('-'), role: 'admin', displayName: 'Synthetic', ambulatoryName: 'Synthetic Clinic', encryptedMasterKey: 'wrapped', salt: 'salt' });
const binding = Object.freeze({ clientId: 'client.synthetic.a', clientPlatform: 'ipados' as const });
const request = (headers: HeadersInit = {}) => new Request('http://127.0.0.1/api/auth/native/login', { method: 'POST', headers });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };

function fixture(overrides: Partial<Parameters<typeof createNativeLoginHttpHandler>[0]> = {}) {
    const admissions = new Map<object, typeof binding>(); let verificationCalls = 0; let auditCalls = 0;
    const admission = Object.freeze(Object.create(null)); admissions.set(admission, binding);
    const handler = createNativeLoginHttpHandler({
        verify: async () => { verificationCalls += 1; return { kind: 'verified' as const, account: user }; },
        consume: async (candidate) => { const value = admissions.get(candidate as object) ?? null; admissions.delete(candidate as object); return value; },
        createNativeSession: createNativeServerSession,
        audit: async () => { auditCalls += 1; },
        ...overrides,
    });
    return { handler, admission, admissions, calls: () => ({ verificationCalls, auditCalls }) };
}

test.afterEach(() => clearAllSessions());

test('denies unavailable admission before account evaluation and burns hostile input', async () => {
    const state = fixture();
    const denied = await state.handler(request({ 'x-mediflow-source-surface': 'native', cookie: 'mediflow_session=forged', authorization: 'Bearer local-token' }), null, { username: user.username, password: pin });
    assert.equal(denied.status, 401); assert.equal(state.calls().verificationCalls, 0); assert.equal(denied.headers.get('set-cookie'), null);
    const hostile = await state.handler(request(), state.admission, { username: user.username, password: pin, authChannel: 'native' });
    assert.equal(hostile.status, 401); assert.equal(state.admissions.has(state.admission), false);
    let observed = false; const accessor = {};
    Object.defineProperty(accessor, 'username', { enumerable: true, get: () => { observed = true; throw new Error('must not read'); } });
    const accessorState = fixture(); const accessorResponse = await accessorState.handler(request(), accessorState.admission, accessor);
    assert.equal(accessorResponse.status, 401); assert.equal(observed, false); assert.equal(accessorState.admissions.has(accessorState.admission), false);
});

test('rechecks pairing only after the shared verifier and emits no authority after revocation', async () => {
    const paused = deferred<{ kind: 'verified'; account: typeof user }>();
    const state = fixture({ verify: () => paused.promise });
    const pending = state.handler(request(), state.admission, { username: user.username, password: pin });
    state.admissions.delete(state.admission); paused.resolve({ kind: 'verified', account: user });
    const response = await pending;
    assert.equal(response.status, 401); assert.equal(response.headers.get('set-cookie'), null); assert.equal(state.admissions.has(state.admission), false);
});

test('shared credential denial, replay, and handler exceptions cannot leave a cookie or admission', async () => {
    const locked = fixture({ verify: async () => ({ kind: 'denied' as const, failureClass: 'locked', status: 423 as const, body: { error: 'locked', code: 'AUTH_LOCKED', message: 'Synthetic', retryAfterSeconds: 1 } }) });
    const denied = await locked.handler(request(), locked.admission, { username: user.username, password: wrongPin });
    assert.equal(denied.status, 423); assert.equal(denied.headers.get('retry-after'), '1'); assert.equal(denied.headers.get('set-cookie'), null);
    const replay = await locked.handler(request(), locked.admission, { username: user.username, password: pin });
    assert.notEqual(replay.status, 200); assert.equal(replay.headers.get('set-cookie'), null); assert.equal(locked.admissions.has(locked.admission), false);
    const failed = fixture({ verify: async () => { throw new Error('synthetic verifier failure'); } });
    assert.equal((await failed.handler(request(), failed.admission, { username: user.username, password: pin })).status, 401);
    assert.equal(failed.admissions.has(failed.admission), false);
});

test('allows one fresh admission, fixes the cookie, and contains audit failure after authority creation', async () => {
    const state = fixture({ audit: async () => { throw new Error('synthetic audit failure'); } });
    const response = await state.handler(request({ 'x-mediflow-source-surface': 'web', cookie: 'mediflow_session=forged' }), state.admission, { username: user.username, password: pin });
    assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie') ?? '', /^mediflow_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax/i);
    const sessionId = (response.headers.get('set-cookie') ?? '').slice('mediflow_session='.length).split(';', 1)[0];
    assert.equal(isPairedNativeServerSession(getSession(sessionId), binding), true); assert.equal(state.admissions.has(state.admission), false);
    assert.equal((await response.json() as { encryptedMasterKey: string }).encryptedMasterKey, 'wrapped');
});

test('native predicate accepts only server-tagged, exact paired sessions', () => {
    const native = createNativeServerSession(user, binding); const web = createSession(user, 'web'); const legacyNative = createSession(user, 'native');
    assert.equal(isPairedNativeServerSession(native, binding), true);
    assert.equal(isPairedNativeServerSession(native, { ...binding, clientId: 'client.synthetic.b' }), false);
    assert.equal(isPairedNativeServerSession(web, binding), false); assert.equal(isPairedNativeServerSession(legacyNative, binding), false);
    assert.equal(isPairedNativeServerSession({ ...native }, binding), false); assert.equal(isPairedNativeServerSession(new Proxy(native, {}), binding), false);
    clearAllSessions(); assert.equal(isPairedNativeServerSession(native, binding), false);
});

test('route accepts only credentials and the commit has no await between final consume, session, and fixed cookie', () => {
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
    const route = fs.readFileSync(path.join(root, 'app/api/auth/native/login/route.ts'), 'utf8');
    const source = fs.readFileSync(path.join(root, 'lib/security/native-login-http.ts'), 'utf8');
    assert.match(route, /admitNativeBootstrap\(\{ request \}\)/u); assert.match(route, /body\?\.username|body\?\.password/u);
    assert.doesNotMatch(route, /authorization|cookie|source-surface|paired-client/u);
    const commit = source.match(/const paired = await consume\(admission\); consumed = true;([\s\S]*?)response\.cookies\.set\(SESSION_COOKIE_NAME/u)?.[1];
    assert.match(source, /const paired = await consume\(admission\); consumed = true;[\s\S]*?const session = createNativeSession[\s\S]*?response\.cookies\.set\(SESSION_COOKIE_NAME/u);
    assert.doesNotMatch(commit ?? '', /await/u);
});
