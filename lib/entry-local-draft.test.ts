import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntryLocalDraft, restoreEntryDraftDate, type EntryLocalDraft } from './entry-local-draft';
import { encryptData, decryptData } from './security/security';
const scope = { archive: 'synthetic-archive', user: 'synthetic-user', patient: 'synthetic-patient' };
const draft: EntryLocalDraft = { editState: 'dirty', dateSource: 'user', type: 'visit', setting: 'home', content: '<p>Bozza sintetica 757</p>', dictatedDraft: 'Da rivedere', entryDate: '2026-10-29T21:00' };
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
test('untouched editor and default-date-only editor never create a draft', async () => {
    const f = await fixture(), owner = f.create(); await owner.read();
    await owner.save({ ...draft, editState: 'pristine' });
    assert.equal(f.values.size, 0, 'Initial values never imply a user edit');
    const empty = { ...draft, type: 'visit' as const, setting: 'ambulatory' as const, content: '', dictatedDraft: '', dateSource: 'default' as const };
    await owner.save({ ...empty, editState: 'pristine' });
    assert.equal(f.values.size, 0);
    await owner.save({ ...empty, editState: 'dirty' });
    assert.equal(f.values.size, 0);
});
test('text recovers without freezing the default date; explicit date survives', async () => {
    const f = await fixture(), owner = f.create(); await owner.read();
    await owner.save({ ...draft, editState: 'dirty', dateSource: 'default' });
    const recovered = await f.create().read();
    assert.equal(recovered?.content, draft.content);
    assert.equal(recovered?.entryDate, '');
    assert.equal(restoreEntryDraftDate(recovered!, '2026-10-30T10:00'), '2026-10-30T10:00');
    await owner.save({ ...draft, editState: 'dirty', dateSource: 'user' });
    const chosen = await f.create().read();
    assert.equal(restoreEntryDraftDate(chosen!, '2026-10-30T10:00'), draft.entryDate);
});

test('explicit discard drains pending saves and retires the owner before later writes can restore the draft', async () => {
    const f = await fixture(), owner = f.create(); await owner.read();
    const otherScope = f.create({ ...scope, patient: 'other' }); await otherScope.read(); await otherScope.save(draft);
    const pending = owner.save(draft);
    const discarded = owner.discard();
    const late = owner.save({ ...draft, content: 'Late autosave' });
    await Promise.all([pending, discarded, late]);
    assert.equal(await f.create().read(), null);
    assert.deepEqual(await f.create({ ...scope, patient: 'other' }).read(), draft);
    await owner.save(draft);
    assert.equal(await f.create().read(), null);
});

test('failed explicit discard preserves the draft and can be retried after storage recovers', async () => {
    const f = await fixture(), owner = f.create(); await owner.read(); await owner.save(draft);
    const remove = f.storage.removeItem;
    f.storage.removeItem = () => { throw new Error('Synthetic storage failure'); };
    await assert.rejects(owner.discard(), /Synthetic storage failure/);
    assert.deepEqual(await f.create().read(), draft);
    f.storage.removeItem = remove;
    await owner.discard();
    assert.equal(await f.create().read(), null);
});
