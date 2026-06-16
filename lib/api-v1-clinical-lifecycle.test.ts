// WUL-308: uniform soft-delete body contract for /api/v1 clinical sub-resources
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClinicalDeleteBody } from './api-v1-clinical-lifecycle';

function deleteRequest(body?: unknown): Request {
    return new Request('http://127.0.0.1/api/v1/patients/p1/therapies/t1', {
        method: 'DELETE',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

test('parseClinicalDeleteBody defaults to a fresh tombstone when no body is sent', async () => {
    const result = await parseClinicalDeleteBody(deleteRequest());
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.values.version, undefined);
    assert.ok(result.values.deletedAt instanceof Date);
    assert.equal(result.values.deletionReason, 'api-v1-delete');
});

test('parseClinicalDeleteBody passes through version and trimmed tombstone fields', async () => {
    const result = await parseClinicalDeleteBody(deleteRequest({
        version: 3,
        deletedAt: '2026-05-02T12:00:00.000Z',
        deletionReason: '  motivo clinico  ',
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.values.version, 3);
    assert.equal(result.values.deletedAt, '2026-05-02T12:00:00.000Z');
    assert.equal(result.values.deletionReason, 'motivo clinico');
});

test('parseClinicalDeleteBody rejects explicit tombstone clearing on DELETE', async () => {
    assert.deepEqual(
        await parseClinicalDeleteBody(deleteRequest({ deletedAt: null })),
        { ok: false, error: 'Invalid deletedAt' },
    );
    assert.deepEqual(
        await parseClinicalDeleteBody(deleteRequest({ deletedAt: '' })),
        { ok: false, error: 'Invalid deletedAt' },
    );
});

test('parseClinicalDeleteBody rejects malformed deletionReason and JSON bodies', async () => {
    assert.deepEqual(
        await parseClinicalDeleteBody(deleteRequest({ deletionReason: 1234 })),
        { ok: false, error: 'Invalid deletionReason' },
    );
    assert.deepEqual(
        await parseClinicalDeleteBody(deleteRequest({ deletionReason: '   ' })),
        { ok: false, error: 'Invalid deletionReason' },
    );
    assert.deepEqual(
        await parseClinicalDeleteBody(deleteRequest([1, 2])),
        { ok: false, error: 'Invalid JSON body' },
    );

    const malformed = new Request('http://127.0.0.1/api/v1/patients/p1/therapies/t1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-json',
    });
    assert.deepEqual(
        await parseClinicalDeleteBody(malformed),
        { ok: false, error: 'Invalid JSON body' },
    );
});
