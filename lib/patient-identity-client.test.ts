import assert from 'node:assert/strict';
import test from 'node:test';
import { db, ApiConflictError } from './db';
import { generateMasterKey } from './security/security';

for (const operation of ['update', 'create', 'create-fenced']) test(`conflitto identificativo comprensibile nel client: ${operation}`, async t => {
    db.setKey(await generateMasterKey()); t.after(() => db.setKey(null));
    t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'PATIENT_IDENTIFIER_DUPLICATE', error: 'RAW_IDENTIFIER_SENTINEL' }, { status: 409 }));
    const item = { id: 'synthetic-client', firstName: 'Ada', lastName: 'Sintetica', taxCode: 'RSSMRA80A01H501U', address: '', phone: '', createdAt: new Date(), updatedAt: new Date() };
    const operationResult = operation === 'update' ? db.patients.update(item.id, { version: 1, taxCode: item.taxCode })
        : db.patients.add(item, operation === 'create-fenced' ? { createContext: { nonce: 'a'.repeat(64), ambulatoryId: 'synthetic-clinic', expiresAt: Date.now() + 60_000, signal: new AbortController().signal, isCurrent: () => true } } : undefined);
    await assert.rejects(operationResult, error => {
        assert.ok(error instanceof Error); assert.ok(!(error instanceof ApiConflictError));
        assert.match(error.message, /stesso identificativo/); assert.doesNotMatch(error.message, /RAW_IDENTIFIER_SENTINEL/);
        return true;
    });
});
