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
    await assert.rejects(nukeTestData(false), /Attachment cleanup incomplete/);
    assert.deepEqual(deleted, [item.patientId]);
});


test('document delete wiring captures before confirmation and provides explicit reread on failure', () => {
    const source = fs.readFileSync('components/document-upload.tsx', 'utf8');
    const handler = source.slice(source.indexOf('const handleDelete ='), source.indexOf('/* @Codex: extraction-only'));
    assert.ok(handler.indexOf('captureAttachmentWritePrecondition(file)') < handler.indexOf('await confirm('));
    assert.match(handler, /db\.attachments\.delete\(file\.id, \{ attachmentPrecondition \}\)/);
    assert.doesNotMatch(handler, /db\.attachments\.get|fetch\(/);
    assert.match(source, /onClick=\{refreshAttachments\}[^>]*>Rileggi elenco/);
    const seeder = fs.readFileSync('components/data-seeder.tsx', 'utf8');
    assert.match(seeder, /Eliminazione non completata/);
    assert.match(seeder, /Alcuni dati potrebbero essere già stati eliminati/);
});
