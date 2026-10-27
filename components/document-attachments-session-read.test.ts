import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { db } from '../lib/db';
import { MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT } from '../lib/api-table-response';

function consumerRead(file: string): () => Promise<unknown> {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const readers: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && (node.expression.name.text === 'toArray' || (file.includes('fabric-review') && node.expression.name.text === 'get'))
            && node.expression.expression.getText(source).startsWith('db.attachments')) readers.push(node);
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(readers.length, 1);
    const expression = ts.transpile(readers[0]!.getText(source), { target: ts.ScriptTarget.ESNext });
    return runInNewContext(`(() => ${expression.trim().replace(/;$/u, '')})`, {
        db, id: file.includes('fabric-review') ? 'synthetic-attachment' : 'synthetic-patient',
        patientId: 'synthetic-patient', attachmentIds: ['synthetic-attachment'],
    });
}

const key = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

for (const file of ['components/document-upload.tsx', 'app/patients/[id]/modules/page.tsx', 'components/kree8/kree8-clinical-cockpit.tsx',
    'components/timeline-entry-card.tsx', 'app/patients/[id]/entries/new/page.tsx', 'components/document-synthesis-fabric-review-card.tsx']) {
    test(`${file}: attachment list cannot dispatch while locked and resumes only with a new session`, async t => {
        db.setKey(null);
        t.after(() => db.setKey(null));
        const requests: string[] = [];
        const item = { id: 'synthetic-attachment', patientId: 'synthetic-patient', name: 'source.txt' };
        const single = file.includes('fabric-review');
        t.mock.method(globalThis, 'fetch', async (url: string) => { requests.push(url); return Response.json(single ? item : [item]); });
        const read = consumerRead(file);
        await assert.rejects(read(), { name: 'AbortError' });
        assert.deepEqual(requests, []);
        db.setKey(await key());
        assert.deepEqual(await read(), single ? item : [item]);
        assert.equal(requests.length, 1);
        assert.ok(String(requests[0]).startsWith('/api/attachments'));
    });

    test(`${file}: lock aborts the actual list request and a late 401 cannot revoke its replacement`, async t => {
        db.setKey(await key());
        t.after(() => db.setKey(null));
        const events = new EventTarget();
        const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
        Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
        t.after(() => {
            if (previous) Object.defineProperty(globalThis, 'window', previous);
            else Reflect.deleteProperty(globalThis, 'window');
        });
        let denials = 0;
        events.addEventListener(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, () => { denials++; db.setKey(null); });
        let reply!: (response: Response) => void;
        const response = new Promise<Response>(resolve => { reply = resolve; });
        let signal: AbortSignal | undefined;
        t.mock.method(globalThis, 'fetch', async (_url: string, options?: RequestInit) => {
            signal = options?.signal ?? undefined;
            return response;
        });
        const outcome = consumerRead(file)().then(value => ({ value }), error => ({ error }));
        assert.ok(signal);
        assert.equal(signal.aborted, false);
        db.setKey(null);
        assert.equal(signal.aborted, true);
        db.setKey(await key());
        const replacement = db.getSessionReadSignal();
        reply(new Response(null, { status: 401 }));
        const result = await outcome;
        assert.ok('error' in result && result.error.name === 'AbortError');
        assert.equal(denials, 0);
        assert.equal(replacement.aborted, false);
    });

    test(`${file}: a current attachment denial still revokes the active session`, async t => {
        db.setKey(await key());
        t.after(() => db.setKey(null));
        const events = new EventTarget();
        const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
        Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
        t.after(() => {
            if (previous) Object.defineProperty(globalThis, 'window', previous);
            else Reflect.deleteProperty(globalThis, 'window');
        });
        let denials = 0;
        events.addEventListener(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, () => { denials++; db.setKey(null); });
        t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 401 }));
        await consumerRead(file)().catch(error => assert.equal(error.name, 'AbortError'));
        assert.equal(denials, 1);
        assert.equal(db.isKeySet(), false);
    });
}
