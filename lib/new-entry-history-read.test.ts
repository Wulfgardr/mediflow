import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { db } from './db';
import { MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT } from './api-table-response';

function previousEntriesRead(): () => Promise<unknown[]> {
    const file = new URL('../app/patients/[id]/entries/new/page.tsx', import.meta.url);
    const source = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'entriesRead'
            && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert(callback && ts.isArrowFunction(callback), 'The new-entry history read callback must remain identifiable');
    return new Function('db', 'id', `return (${callback.getText(source)})`)(db, 'new-entry-synthetic-patient');
}

for (const status of [401, 403, 503]) test(`new-entry history rejects ${status} without manufacturing an empty list`, async t => {
    db.setKey(await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    const session = db.getSessionReadSignal(), events = new EventTarget();
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
    t.after(() => {
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
        else Reflect.deleteProperty(globalThis, 'window');
        db.setKey(null);
    });
    let retirements = 0, requests = 0;
    events.addEventListener(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, () => { retirements++; db.setKey(null); });
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
        requests++; assert.equal(init.method, undefined);
        assert.equal(new URL(url, 'http://127.0.0.1').searchParams.get('patientId'), 'new-entry-synthetic-patient');
        return new Response(null, { status });
    });
    await assert.rejects(previousEntriesRead()(), status === 503 ? /Failed to fetch/u : /Authenticated list unavailable/u);
    assert.equal(requests, 1); assert.equal(retirements, status === 503 ? 0 : 1);
    assert.equal(session.aborted, status !== 503);
});

test('new-entry history accepts an actually empty successful read', async t => {
    t.mock.method(globalThis, 'fetch', async () => Response.json([]));
    assert.deepEqual(await previousEntriesRead()(), []);
});
