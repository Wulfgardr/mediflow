/* @Codex: encrypted browser payload against the authoritative creation schema. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { db, type Attachment } from './db';
import { attachmentCreateSchema } from './api-schemas/attachments';
import { generateMasterKey, decryptData } from './security/security';

test('attachment creation sends encrypted input and leaves timestamps to the host', async t => {
    const key = await generateMasterKey();
    db.setKey(key);
    t.after(() => db.setKey(null));
    const input: Attachment = {
        id: 'synthetic-attachment', patientId: 'synthetic-patient', name: 'synthetic.txt',
        type: 'text/plain', size: 4, data: 'data:text/plain;base64,dGVzdA==',
        path: 'uploads/synthetic.txt', createdAt: new Date('2020-01-01T00:00:00.000Z'),
    };
    t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
        assert.equal(url, '/api/attachments');
        assert.equal(options.method, 'POST');
        const body = JSON.parse(options.body as string);
        assert.equal(Object.hasOwn(body, 'createdAt'), false);
        assert.equal(attachmentCreateSchema.safeParse(body).success, true);
        for (const field of ['name', 'path', 'data'] as const) {
            assert.match(body[field], /^ENC:/);
            const [, iv, data] = body[field].split(':');
            assert.equal(await decryptData(data, iv, key), input[field]);
        }
        return Response.json({ id: input.id }, { status: 201 });
    });
    assert.equal(await db.attachments.add(input), input.id);
    assert.equal(input.createdAt.toISOString(), '2020-01-01T00:00:00.000Z');
});
