import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test, { type TestContext } from 'node:test';
import ts from 'typescript';
import { db } from '../lib/db';
import { MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT } from '../lib/api-table-response';
import { AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY } from '../lib/ai-document-synthesis-kill-switch';

function consumerRead(file: string): () => Promise<unknown> {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const readers: ts.ArrowFunction[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'useLiveQueryState') {
            const callback = node.arguments[0];
            if (callback && ts.isArrowFunction(callback) && callback.body.getText(source).includes('AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY')) readers.push(callback);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(readers.length, 1, 'exactly one document synthesis setting reader in this consumer');
    return runInNewContext(`(${readers[0]!.getText(source)})`, { db, AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY, AbortController, AbortSignal });
}

const key = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const setting = () => Response.json({ key: AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY, value: 'disabled' });
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
function authEvents(t: TestContext): EventTarget {
    const events = new EventTarget();
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, 'window', previous);
        else Reflect.deleteProperty(globalThis, 'window');
    });
    return events;
}

for (const file of ['app/patients/[id]/modules/page.tsx', 'components/document-upload.tsx']) {
    test(`${file}: locked reader cannot dispatch`, async t => {
        db.setKey(null);
        let requests = 0;
        t.mock.method(globalThis, 'fetch', async () => { requests++; return setting(); });
        await assert.rejects(consumerRead(file)(), { name: 'AbortError' });
        assert.equal(requests, 0);
    });

    test(`${file}: a retired 401 cannot retire the replacement session`, async t => {
        db.setKey(await key());
        t.after(() => db.setKey(null));
        const events = authEvents(t);
        let denials = 0;
        events.addEventListener(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, () => { denials++; db.setKey(null); });
        const reply = deferred<Response>();
        let requests = 0;
        t.mock.method(globalThis, 'fetch', async () => {
            requests++;
            return requests === 1 ? reply.promise : setting();
        });
        const read = consumerRead(file);
        const oldRead = read();
        const outcome = oldRead.then(value => ({ value }), error => ({ error }));
        assert.equal(requests, 1);
        db.setKey(null);
        db.setKey(await key());
        const replacement = db.getSessionReadSignal();
        assert.deepEqual(await read(), { key: AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY, value: 'disabled' });
        reply.resolve(new Response(null, { status: 401 }));
        const result = await outcome;
        assert.equal(denials, 0);
        assert.equal(replacement.aborted, false);
        assert.equal(db.isKeySet(), true);
        assert.ok('error' in result && result.error instanceof DOMException && result.error.name === 'AbortError');
        assert.equal(requests, 2);
    });

    test(`${file}: a current 401 still retires the session`, async t => {
        db.setKey(await key());
        t.after(() => db.setKey(null));
        const events = authEvents(t);
        let denials = 0;
        events.addEventListener(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, () => { denials++; db.setKey(null); });
        t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 401 }));
        await consumerRead(file)().catch(error => assert.equal(error.name, 'AbortError'));
        assert.equal(denials, 1);
        assert.equal(db.isKeySet(), false);
    });
}
