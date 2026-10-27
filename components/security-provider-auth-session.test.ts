import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { db } from '../lib/db';

test('SecurityProvider ignores old or unscoped denial events and revokes only their current session', async t => {
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
    const handle = runInNewContext(ts.transpile(`(${callback.getText(source)})`, { target: ts.ScriptTarget.ESNext }), {
        db, authorityAttemptGenerationRef: generation,
        clearClientAuthority: () => { revocations++; db.setKey(null); }, setAuthErrorMessage: () => {},
    }) as (event: Event) => void;
    const masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    db.setKey(masterKey);
    t.after(() => db.setKey(null));
    const old = db.getSessionReadSignal();
    db.setKey(null);
    db.setKey(masterKey);
    const current = db.getSessionReadSignal();
    for (const sessionSignal of [old, null, undefined, new AbortController().signal]) {
        handle(new CustomEvent('mediflow:api-auth-unavailable', { detail: { status: 401, sessionSignal } }));
        assert.equal(db.isKeySet(), true);
        assert.equal(revocations, 0);
        assert.equal(generation.current, 0);
    }
    handle(new CustomEvent('mediflow:api-auth-unavailable', { detail: { status: 401, sessionSignal: current } }));
    assert.equal(revocations, 1);
    assert.equal(generation.current, 1);
    assert.equal(db.isKeySet(), false);
});
