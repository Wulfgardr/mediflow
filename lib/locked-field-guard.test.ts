import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
    LOCKED_CIPHERTEXT_KEY,
    LOCKED_DATA_PLACEHOLDER,
    getLockedFields,
    isEncryptedFieldValue,
    isLockedDataPlaceholder,
    rememberLockedCiphertext,
    takeLockedCiphertext,
} from './locked-field-guard';
import { decryptData, encryptData, generateMasterKey } from './security';
import { db } from './db';

type FetchCall = { url: string; method: string; body?: Record<string, unknown> };

function installFetchMock(responder: (call: FetchCall) => unknown) {
    const calls: FetchCall[] = [];
    (globalThis as Record<string, unknown>).fetch = async (url: string, init?: RequestInit) => {
        const call: FetchCall = {
            url: String(url),
            method: init?.method ?? 'GET',
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
        };
        calls.push(call);
        return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => responder(call),
        };
    };
    return calls;
}

describe('locked-field-guard helpers', () => {
    it('recognizes the placeholder and ENC values', () => {
        assert.equal(isLockedDataPlaceholder(LOCKED_DATA_PLACEHOLDER), true);
        assert.equal(isLockedDataPlaceholder('altro testo'), false);
        assert.equal(isEncryptedFieldValue('ENC:iv:data'), true);
        assert.equal(isEncryptedFieldValue('testo in chiaro'), false);
        assert.equal(isEncryptedFieldValue(undefined), false);
    });

    it('remembers only ENC ciphertexts and takes them back out', () => {
        const item: Record<string, unknown> = { id: 'x' };
        rememberLockedCiphertext(item, 'notes', 'ENC:iv:data');
        rememberLockedCiphertext(item, 'phone', 'not-a-ciphertext');
        assert.deepEqual(getLockedFields(item), ['notes']);

        const spread = { ...item };
        const taken = takeLockedCiphertext(spread);
        assert.deepEqual(taken, { notes: 'ENC:iv:data' });
        assert.equal(LOCKED_CIPHERTEXT_KEY in spread, false);
        assert.equal(takeLockedCiphertext({ id: 'y' }), undefined);
    });
});

describe('db locked-data round trip (WUL-323)', () => {
    let originalFetch: unknown;

    beforeEach(() => {
        originalFetch = (globalThis as Record<string, unknown>).fetch;
    });

    afterEach(() => {
        (globalThis as Record<string, unknown>).fetch = originalFetch;
        db.setKey(null);
    });

    it('preserves the original ciphertext when decrypt fails and restores it on save', async () => {
        const keyA = await generateMasterKey();
        const keyB = await generateMasterKey();
        const { iv, data } = await encryptData('dato clinico riservato', keyA);
        const ciphertext = `ENC:${iv}:${data}`;

        // Read with the wrong key: decrypt fails, the placeholder appears but
        // the ciphertext must be preserved on the item.
        db.setKey(keyB);
        const calls = installFetchMock((call) => {
            if (call.method === 'GET') {
                return { id: 'p1', version: 3, notes: ciphertext };
            }
            return { id: 'p1' };
        });

        const patient = (await db.patients.get('p1')) as unknown as Record<string, unknown>;
        assert.equal(patient.notes, LOCKED_DATA_PLACEHOLDER);
        assert.deepEqual(getLockedFields(patient), ['notes']);

        // Full save (add/put): the original ciphertext is written back, not the
        // placeholder, and the side-channel never reaches the wire.
        await db.patients.put({ ...(patient as object) } as never, { suppressNotify: true });
        const postBody = calls.find((c) => c.method === 'POST')?.body;
        assert.ok(postBody);
        assert.equal(postBody.notes, ciphertext);
        assert.equal(LOCKED_CIPHERTEXT_KEY in postBody, false);

        // The preserved ciphertext is still decryptable with the right key.
        const parts = String(postBody.notes).split(':');
        assert.equal(await decryptData(parts[2], parts[1], keyA), 'dato clinico riservato');
    });

    it('refuses to persist the bare placeholder when no ciphertext is preserved', async () => {
        db.setKey(await generateMasterKey());
        installFetchMock(() => ({ id: 'p2' }));

        await assert.rejects(
            db.patients.put({ id: 'p2', notes: LOCKED_DATA_PLACEHOLDER } as never, { suppressNotify: true }),
            /Refusing to persist/,
        );
    });

    it('drops an orphan placeholder from partial updates instead of writing it', async () => {
        db.setKey(await generateMasterKey());
        const calls = installFetchMock(() => ({ id: 'p3' }));

        await db.patients.update(
            'p3',
            { version: 1, notes: LOCKED_DATA_PLACEHOLDER, phone: '000 0000000' } as never,
            { suppressNotify: true },
        );
        const putBody = calls.find((c) => c.method === 'PUT')?.body;
        assert.ok(putBody);
        assert.equal('notes' in putBody, false);
        assert.equal(putBody.version, 1);
        // Other encrypted fields keep flowing normally.
        assert.ok(String(putBody.phone).startsWith('ENC:'));
    });

    it('restores locked ciphertext even when the key has been cleared', async () => {
        const keyA = await generateMasterKey();
        const keyB = await generateMasterKey();
        const { iv, data } = await encryptData('telefono segreto', keyA);
        const ciphertext = `ENC:${iv}:${data}`;

        db.setKey(keyB);
        const calls = installFetchMock((call) => {
            if (call.method === 'GET') {
                return { id: 'p4', version: 1, phone: ciphertext };
            }
            return { id: 'p4' };
        });
        const patient = (await db.patients.get('p4')) as unknown as Record<string, unknown>;
        assert.equal(patient.phone, LOCKED_DATA_PLACEHOLDER);

        // Session locked between read and save: the guard must still hold.
        db.setKey(null);
        await db.patients.put({ ...(patient as object) } as never, { suppressNotify: true });
        const postBody = calls.find((c) => c.method === 'POST')?.body;
        assert.ok(postBody);
        assert.equal(postBody.phone, ciphertext);
        assert.equal(LOCKED_CIPHERTEXT_KEY in postBody, false);
    });
});
