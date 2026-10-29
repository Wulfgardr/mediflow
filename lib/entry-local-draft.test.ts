import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntryLocalDraft, type EntryLocalDraft } from './entry-local-draft';
import { encryptData, decryptData } from './security/security';
const scope = { archive: 'synthetic-archive', user: 'synthetic-user', patient: 'synthetic-patient' };
const draft: EntryLocalDraft = { type: 'visit', setting: 'home', content: '<p>Bozza sintetica 757</p>', dictatedDraft: 'Da rivedere', entryDate: '2026-10-29T21:00' };
async function fixture() {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const cipher = { async sealLocalDraft(value: unknown) { const result = await encryptData(value, key); return `ENC:${result.iv}:${result.data}`; },
        async openLocalDraft(value: string) { const [, iv, data] = value.split(':'); return decryptData(data, iv, key); } };
    const locks = { request: async (_key: string, fn: () => unknown) => fn() } as LockManager;
    return { values, storage, cipher, locks, create: (binding = scope) => createEntryLocalDraft(binding, storage, cipher, locks) };
}
test('unregistered editor text survives disposal and reopening, encrypted and scoped to archive/user/patient', async () => {
    const f = await fixture(), first = f.create(); assert.equal(await first.read(), null); await first.save(draft); first.dispose();
    assert.doesNotMatch([...f.values.values()].join(''), /Bozza sintetica|Da rivedere/);
    assert.deepEqual(await f.create().read(), draft);
    for (const binding of [{ ...scope, user: 'other' }, { ...scope, patient: 'other' }, { ...scope, archive: 'other' }]) assert.equal(await f.create(binding).read(), null);
    const restored = f.create(); await restored.read(); await restored.save(null); assert.equal(await f.create().read(), null);
});
test('concurrent tab and corrupted ciphertext cannot overwrite the recoverable original', async () => {
    const f = await fixture(), a = f.create(), b = f.create(); await a.read(); await b.read(); await a.save(draft);
    await assert.rejects(b.save({ ...draft, content: 'Other tab' }), /altra|altr/u); assert.deepEqual(await f.create().read(), draft);
    const [key, value] = [...f.values][0]; f.values.set(key, value.slice(0, -4)+'AAAA');
    await assert.rejects(f.create().read()); assert.equal(f.values.get(key), value.slice(0, -4)+'AAAA');
});
