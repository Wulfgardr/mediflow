import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountProfileDraftMemory } from './account-profile-draft';
import { AccountProfileEditor, type AccountProfile } from './account-profile-editor';

const profile: AccountProfile = { userId: 'inventato', username: ['profilo', 'inventato'].join('-'), archiveGeneration: 'archivio-inventato',
    profileVersion: 'versione-inventata', displayName: 'Nome salvato', ambulatoryName: null };
const draft = { doctorName: 'Nome in bozza', clinicName: 'Studio in bozza' };

test('riprende una copia della bozza soltanto per lo stesso account e archivio, una sola volta', () => {
    const memory = new AccountProfileDraftMemory();
    memory.retain(profile, draft);
    assert.deepEqual(memory.resume(profile), draft);
    assert.equal(memory.resume(profile), null);
    for (const other of [{ ...profile, userId: 'altro' }, { ...profile, archiveGeneration: 'altro' }]) {
        memory.retain(profile, draft);
        assert.equal(memory.resume(other), null);
        assert.equal(memory.resume(profile), null);
    }
});

test('abbandono esplicito e stato salvato eliminano la bozza', () => {
    const memory = new AccountProfileDraftMemory();
    memory.retain(profile, draft); memory.discard(); assert.equal(memory.resume(profile), null);
    memory.retain(profile, draft);
    memory.retain(profile, { doctorName: profile.displayName!, clinicName: '' });
    assert.equal(memory.resume(profile), null);
});

test('la ripresa non scrive, richiede una rilettura e conserva il confronto con il profilo corrente', async () => {
    const calls: string[] = [];
    const owner = new AccountProfileEditor(profile.userId, () => true, () => {}, () => {}, (async (_url, init) => {
        calls.push(init?.method ?? 'GET');
        return Response.json({ ...profile, operation: 'account-profile.read.v1', contractVersion: 1 });
    }) as typeof fetch);
    await owner.read(); owner.resumeDraft(draft); await owner.save();
    assert.deepEqual(calls, ['GET']); assert.equal(owner.state.requiresRead, true);
    await owner.read(); assert.deepEqual(owner.state.draft, draft); assert.equal(owner.state.requiresRead, false);
    owner.dispose(); owner.resumeDraft({ doctorName: 'Tardivo', clinicName: '' });
    assert.deepEqual(owner.state.draft, draft);
});
