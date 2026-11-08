import { sourceVariableDeclaration } from '../scripts/test-support/source-structure.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { db, captureAttachmentWritePrecondition, type Attachment } from './db';
import { nukeTestData } from './seeder';

const record = (): Attachment => ({ id: 'synthetic-attachment', patientId: 'synthetic-patient', name: 'synthetic',
    path: 'synthetic', type: 'text/plain', size: 1, createdAt: new Date(0),
    currentness: { sourceRef: 'a'.repeat(64), revision: 1, freshnessEpoch: 1 } });

test('facade requires an observed snapshot and dispatches it without refresh or silent retry', async t => {
    const calls: Array<{ method: string; body: unknown }> = [];
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
        calls.push({ method: options.method!, body: JSON.parse(options.body as string) });
        return Response.json({ error: 'Attachment changed; reload and retry' }, { status: 409 });
    });
    await assert.rejects(db.attachments.delete('synthetic-attachment'), /precondition/);
    await assert.rejects(db.attachments.update('synthetic-attachment', { summarySnapshot: null } as unknown as Partial<Attachment>), /precondition/);
    assert.equal(calls.length, 0);
    const displayed = record();
    const attachmentPrecondition = captureAttachmentWritePrecondition(displayed);
    displayed.currentness = { ...displayed.currentness!, revision: 2 };
    await assert.rejects(db.attachments.delete(displayed.id, { attachmentPrecondition }));
    await assert.rejects(db.attachments.update(displayed.id, { summarySnapshot: null } as unknown as Partial<Attachment>, { attachmentPrecondition }));
    assert.deepEqual(calls, [
        { method: 'DELETE', body: { patientId: displayed.patientId, expected: record().currentness } },
        { method: 'PUT', body: { summarySnapshot: null, patientId: displayed.patientId, expected: record().currentness } },
    ]);
    await assert.rejects(db.attachments.delete('other-id', { attachmentPrecondition }), /precondition/);
    assert.equal(calls.length, 2);
});

test('clear fallback carries its list snapshot; bulkDelete requires explicit records', async t => {
    const item = record(); const methods: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown, options?: RequestInit) => {
        const method = options?.method ?? 'GET'; methods.push(method);
        if (url === '/api/attachments' && method === 'DELETE') return new Response(null, { status: 405 });
        if (method === 'GET') return Response.json([item]);
        assert.deepEqual(JSON.parse(options!.body as string), { patientId: item.patientId, expected: item.currentness });
        return Response.json({ success: true });
    });
    await db.attachments.clear();
    assert.deepEqual(methods, ['DELETE', 'GET', 'DELETE']);
    await assert.rejects(db.attachments.bulkDelete([item.id]), /precondition/);
    await db.attachments.bulkDelete([item.id], { attachmentRecords: [item] });
    assert.deepEqual(methods, ['DELETE', 'GET', 'DELETE', 'DELETE']);
});

test('seeder reports attachment cleanup failure after the earlier patient deletion', async t => {
    const item = record(); const deleted: string[] = [];
    t.mock.method(console, 'log', () => {});
    t.mock.method(db.patients, 'toArray', async () => [{ id: item.patientId, taxCode: 'TEST-synthetic', version: 1 }]);
    t.mock.method(db.patients, 'delete', async (id: string) => { deleted.push(id); });
    for (const table of [db.entries, db.therapies, db.checkups, db.conversations]) t.mock.method(table, 'toArray', async () => []);
    t.mock.method(db.attachments, 'toArray', async () => [item]);
    t.mock.method(db.attachments, 'delete', async (id: string, options: { attachmentPrecondition: unknown }) => {
        assert.equal(id, item.id); assert.deepEqual(options.attachmentPrecondition, captureAttachmentWritePrecondition(item));
        throw new Error('synthetic conflict');
    });
    await assert.rejects(nukeTestData(false), /Eliminazione non completata/);
    assert.deepEqual(deleted, [item.patientId]);
});

test('document delete wiring captures before confirmation and provides explicit reread on failure', () => {
    const source = fs.readFileSync('components/document-upload.tsx', 'utf8');
    const handler = sourceVariableDeclaration(source, 'handleDelete');
    assert.ok(handler.indexOf('captureAttachmentWritePrecondition(file)') < handler.indexOf('await confirm('));
    assert.ok(handler.indexOf('AttachmentCollectionView.capture(patientId, currentAttachments)') < handler.indexOf('await confirm('));
    assert.match(handler, /db\.attachments\.delete\(file\.id, \{ attachmentPrecondition, attachmentCollection \}\)/);
    assert.doesNotMatch(handler, /db\.attachments\.get|fetch\(/);
});

test('a batch sends the reviewed collection, extends it with its own confirmed rows and stops on a changed list', async t => {
    const { AttachmentCollectionView, AttachmentCollectionChangedError } = await import('./attachment-collection-client');
    const shown = record();
    const created = { sourceRef: 'b'.repeat(64), revision: 1, freshnessEpoch: 1 };
    const bodies: Array<Record<string, unknown>> = [];
    const answers = [
        () => Response.json({ id: 'synthetic-new', currentness: created }, { status: 201 }),
        () => Response.json({ error: 'Attachment collection changed. Review the documents again.', code: 'ATTACHMENT_COLLECTION_CHANGED' }, { status: 409 }),
    ];
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
        bodies.push(JSON.parse(options.body as string));
        return answers.shift()!();
    });
    db.setKey(await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    t.after(() => db.setKey(null));
    const view = AttachmentCollectionView.capture(shown.patientId, [shown]);
    const file = (id: string) => ({ id, patientId: shown.patientId, name: 'synthetic', path: 'synthetic', type: 'text/plain', size: 1, createdAt: new Date(0) }) as Attachment;
    assert.equal(await db.attachments.add(file('synthetic-new'), { attachmentCollection: view }), 'synthetic-new');
    await assert.rejects(db.attachments.add(file('synthetic-next'), { attachmentCollection: view }), AttachmentCollectionChangedError);
    assert.deepEqual(bodies.map(body => body.expectedCollection), [
        [{ id: shown.id, currentness: shown.currentness }],
        [{ id: shown.id, currentness: shown.currentness }, { id: 'synthetic-new', currentness: created }],
    ]);
    await assert.rejects(db.attachments.add({ ...file('other'), patientId: 'other-patient' }, { attachmentCollection: view }), /collection unavailable/);
    assert.equal(bodies.length, 2);
    assert.throws(() => AttachmentCollectionView.capture(shown.patientId, undefined), /collection unavailable/);
    assert.throws(() => AttachmentCollectionView.capture(shown.patientId, [{ ...shown, currentness: undefined }]), /collection unavailable/);
});

test('delete sends the reviewed collection; a changed list is a typed refusal, an unanswered write retires the view', async t => {
    const { AttachmentCollectionView, AttachmentCollectionChangedError } = await import('./attachment-collection-client');
    const shown = record();
    const bodies: Array<Record<string, unknown>> = [];
    let answer = () => Response.json({ error: 'Attachment collection changed. Review the documents again.', code: 'ATTACHMENT_COLLECTION_CHANGED' }, { status: 409 });
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
        bodies.push(JSON.parse(options.body as string));
        return answer();
    });
    const view = AttachmentCollectionView.capture(shown.patientId, [shown]);
    const attachmentPrecondition = captureAttachmentWritePrecondition(shown);
    await assert.rejects(db.attachments.delete(shown.id, { attachmentPrecondition, attachmentCollection: view }), AttachmentCollectionChangedError);
    assert.deepEqual(bodies[0], { patientId: shown.patientId, expected: shown.currentness,
        expectedCollection: [{ id: shown.id, currentness: shown.currentness }] });
    answer = () => new Response('unavailable', { status: 503 });
    await assert.rejects(db.attachments.delete(shown.id, { attachmentPrecondition, attachmentCollection: view }), (error: unknown) => !(error instanceof AttachmentCollectionChangedError));
    await assert.rejects(db.attachments.delete(shown.id, { attachmentPrecondition, attachmentCollection: view }), AttachmentCollectionChangedError);
    assert.equal(bodies.length, 2, 'a view retired by an unconfirmed write is never dispatched again');
});

test('a retry after a refused file reuses the files already saved instead of uploading duplicates', async () => {
    const { uploadFilesOnce, AttachmentCollectionChangedError } = await import('./attachment-collection-client.ts');
    const first = { name: 'a' }, second = { name: 'b' }, confirmed = new Map<{ name: string }, string>();
    const uploads: string[] = [];
    let refuse = true;
    const upload = async (file: { name: string }) => {
        if (file === second && refuse) { refuse = false; throw new AttachmentCollectionChangedError(); }
        uploads.push(file.name); return `id-${file.name}-${uploads.length}`;
    };
    await assert.rejects(uploadFilesOnce([first, second], confirmed, upload), AttachmentCollectionChangedError);
    assert.deepEqual(await uploadFilesOnce([first, second], confirmed, upload), ['id-a-1', 'id-b-2']);
    assert.deepEqual(uploads, ['a', 'b'], 'the first file is stored once');
    assert.deepEqual(await uploadFilesOnce([second], confirmed, upload), ['id-b-2']);
    assert.equal(confirmed.has(first), false, 'a file removed from the form is forgotten');
});
