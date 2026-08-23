/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createLegacyAttachmentResponseSnapshot } from './attachment-legacy-response';

/* @Codex */
test('legacy attachment snapshot omits host-owned currentness and preserves DB values', () => {
    const createdAt = new Date('2026-08-23T08:30:00.000Z');
    const data = 'ENC:synthetic-ciphertext:synthetic-auth-tag';
    const row = {
        id: 'attachment-1',
        name: 'documento-sintetico.pdf',
        path: 'documento-sintetico.pdf',
        data,
        createdAt,
        documentSourceRef: 'host-only-source-ref',
        documentRevision: 4,
        documentFreshnessEpoch: 8,
    };

    const snapshot = createLegacyAttachmentResponseSnapshot(row);

    assert.ok(snapshot);
    assert.notEqual(snapshot, row);
    assert.ok(Object.isFrozen(snapshot));
    assert.deepEqual(Object.keys(snapshot), ['id', 'name', 'path', 'data', 'createdAt']);
    assert.equal(snapshot.data, data);
    assert.equal(snapshot.createdAt, createdAt);
    assert.deepEqual(row, {
        id: 'attachment-1',
        name: 'documento-sintetico.pdf',
        path: 'documento-sintetico.pdf',
        data,
        createdAt,
        documentSourceRef: 'host-only-source-ref',
        documentRevision: 4,
        documentFreshnessEpoch: 8,
    });
});

/* @Codex */
test('legacy attachment snapshot fails closed without reading unsafe inputs', () => {
    let accessorRead = false;
    const accessorRow = Object.defineProperty({ id: 'attachment-1' }, 'documentSourceRef', {
        enumerable: true,
        get() {
            accessorRead = true;
            throw new Error('must not read accessors');
        },
    });
    const symbolRow = { id: 'attachment-1', [Symbol('host-only')]: 'value' };
    const customPrototypeRow = Object.assign(Object.create({ inherited: true }), { id: 'attachment-1' });
    let proxyTrapCalled = false;
    const proxyRow = new Proxy({ id: 'attachment-1' }, {
        get() {
            proxyTrapCalled = true;
            throw new Error('must not read proxies');
        },
        ownKeys() {
            proxyTrapCalled = true;
            throw new Error('must not enumerate proxies');
        },
    });

    assert.equal(createLegacyAttachmentResponseSnapshot(accessorRow), null);
    assert.equal(accessorRead, false);
    assert.equal(createLegacyAttachmentResponseSnapshot(symbolRow), null);
    assert.equal(createLegacyAttachmentResponseSnapshot(customPrototypeRow), null);
    assert.equal(createLegacyAttachmentResponseSnapshot(proxyRow), null);
    assert.equal(proxyTrapCalled, false);
});

/* @Codex */
test('attachment GET routes cannot spread raw DB rows into legacy responses', () => {
    const routePaths = [
        'app/api/attachments/route.ts',
        'app/api/attachments/[id]/route.ts',
    ];

    for (const routePath of routePaths) {
        const source = readFileSync(resolve(process.cwd(), routePath), 'utf8');
        assert.match(source, /createLegacyAttachmentResponseSnapshot/);
        assert.doesNotMatch(source, /\.\.\.\s*row\b/);
    }
});
