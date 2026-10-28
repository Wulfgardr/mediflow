import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { db } from '../lib/db';
import { fetchDrugAutocomplete } from '../lib/drug-autocomplete-search';
import { MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT } from '../lib/api-table-response';

function denialHandler() {
    const source = ts.createSourceFile('security-provider.tsx', readFileSync('components/security-provider.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleApiAuthUnavailable') callback = node.initializer;
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(callback);
    const generation = { current: 0 };
    let revocations = 0;
    let message: string | null = null;
    const handle = runInNewContext(ts.transpile(`(${callback.getText(source)})`, { target: ts.ScriptTarget.ESNext }), {
        db, authorityAttemptGenerationRef: generation,
        clearClientAuthority: () => { revocations++; db.setKey(null); },
        setAuthErrorMessage: (value: string) => { message = value; },
    }) as (event: Event) => void;
    return { handle, generation, revocations: () => revocations, message: () => message };
}

for (const [name, event] of [
    ['plain event', new Event('mediflow:api-auth-unavailable')],
    ['missing detail', new CustomEvent('mediflow:api-auth-unavailable')],
    ['missing identity', new CustomEvent('mediflow:api-auth-unavailable', { detail: { status: 401 } })],
    ['null identity', new CustomEvent('mediflow:api-auth-unavailable', { detail: { status: 403, sessionSignal: null } })],
    ['undefined identity', new CustomEvent('mediflow:api-auth-unavailable', { detail: { status: 401, sessionSignal: undefined } })],
] as const) test(`SecurityProvider fails closed for an unscoped denial: ${name}`, async t => {
    const h = denialHandler();
    const masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    db.setKey(masterKey);
    t.after(() => db.setKey(null));
    const current = db.getSessionReadSignal();
    h.handle(event);
    assert.equal(h.revocations(), 1);
    assert.equal(h.generation.current, 1);
    assert.equal(db.isKeySet(), false);
    assert.equal(current.aborted, true);
    assert.equal(h.message(), 'Sessione scaduta.');
});

for (const status of [401, 403]) test(`SecurityProvider ignores previous identities and revokes the current session on ${status}`, async t => {
    const h = denialHandler();
    const masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    db.setKey(masterKey);
    t.after(() => db.setKey(null));
    const old = db.getSessionReadSignal();
    db.setKey(null);
    db.setKey(masterKey);
    const current = db.getSessionReadSignal();
    for (const sessionSignal of [old, new AbortController().signal]) {
        h.handle(new CustomEvent('mediflow:api-auth-unavailable', { detail: { status, sessionSignal } }));
        assert.equal(db.isKeySet(), true);
        assert.equal(current.aborted, false);
        assert.equal(h.revocations(), 0);
        assert.equal(h.generation.current, 0);
        assert.equal(h.message(), null);
    }
    h.handle(new CustomEvent('mediflow:api-auth-unavailable', { detail: { status, sessionSignal: current } }));
    assert.equal(h.revocations(), 1);
    assert.equal(h.generation.current, 1);
    assert.equal(db.isKeySet(), false);
    assert.equal(current.aborted, true);
    assert.equal(h.message(), 'Sessione scaduta.');
});

test('SecurityProvider invalidates pending unlock authority on an unscoped denial while locked', () => {
    db.setKey(null);
    const h = denialHandler();
    h.handle(new Event('mediflow:api-auth-unavailable'));
    assert.equal(h.revocations(), 1);
    assert.equal(h.generation.current, 1);
    assert.equal(h.message(), 'Sessione scaduta.');
});

for (const emitter of ['get', 'toArray', 'drug autocomplete'] as const) {
    for (const status of [401, 403]) test(`SecurityProvider revokes on ${emitter} ${status} carrying its captured session identity`, async t => {
        const h = denialHandler();
        const masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        db.setKey(masterKey);
        t.after(() => db.setKey(null));
        const sessionSignal = db.getSessionReadSignal();
        const events = new EventTarget();
        const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
        Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
        t.after(() => previous ? Object.defineProperty(globalThis, 'window', previous) : Reflect.deleteProperty(globalThis, 'window'));
        const emitted: unknown[] = [];
        events.addEventListener(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, event => {
            emitted.push((event as CustomEvent).detail);
            h.handle(event);
        });
        const callerSignal = new AbortController().signal;
        t.mock.method(globalThis, 'fetch', async () => new Response(null, { status }));
        await assert.rejects(() => emitter === 'get'
            ? db.attachments.get('synthetic-id', { signal: callerSignal })
            : emitter === 'toArray'
                ? db.attachments.toArray({ signal: callerSignal })
                : fetchDrugAutocomplete('sintetico', callerSignal));
        assert.deepEqual(emitted, [{ status, sessionSignal }]);
        assert.equal(h.revocations(), 1);
        assert.equal(h.generation.current, 1);
        assert.equal(db.isKeySet(), false);
        assert.equal(sessionSignal.aborted, true);
        assert.equal(callerSignal.aborted, false);
        assert.equal(h.message(), 'Sessione scaduta.');
    });
}
