import assert from 'node:assert/strict';
import test from 'node:test';

import { preparePassphraseAdoption } from './passphrase-adoption-client';
import { validatePassphraseAdoptionPayload } from './passphrase-adoption-validation';
import { generateMasterKey } from './security';
import { createRecoveryWrapping, createUnlockWrapping, openRecoveryWrapping } from './unlock-credential';

const PASSPHRASE = 'cavallo batteria graffetta corretta';
const CURRENT_PIN = ['2', '4', '6', '8'].join('');
const rawKey = async (key: CryptoKey) => Buffer.from(await globalThis.crypto.subtle.exportKey('raw', key)).toString('hex');

test('what the browser prepares is what the server accepts, and the kit opens with the recovery key alone', async () => {
    const masterKey = await generateMasterKey();
    const prepared = await preparePassphraseAdoption(masterKey, PASSPHRASE);

    const request = prepared.request(CURRENT_PIN);
    assert.deepEqual(validatePassphraseAdoptionPayload(request), request);
    assert.match(prepared.recoveryKey, /^(?:[0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/u);

    // The kit is the second wrapping and its salt: it goes beside the backups, the key goes on paper.
    assert.deepEqual(Object.keys(prepared.kit).sort(), ['createdAt', 'format', 'salt', 'version', 'wrappedMasterKey']);
    assert.deepEqual([prepared.kit.format, prepared.kit.version], ['mediflow-recovery-kit', 1]);
    assert.deepEqual([prepared.kit.wrappedMasterKey, prepared.kit.salt], [request.recovery.wrappedMasterKey, request.recovery.salt]);
    const recovered = await openRecoveryWrapping(prepared.kit.wrappedMasterKey, prepared.kit.salt, prepared.recoveryKey);
    assert.equal(await rawKey(recovered.masterKey), await rawKey(masterKey));

    // Neither secret is in what leaves the browser or in what is saved to disk.
    for (const serialized of [JSON.stringify(request), JSON.stringify(prepared.kit)]) {
        assert.equal(serialized.includes(PASSPHRASE), false);
        assert.equal(serialized.includes(prepared.recoveryKey), false);
        assert.equal(serialized.includes(prepared.recoveryKey.replaceAll('-', '')), false);
    }
});

test('a wrapping that does not give the master key back is never offered to the server', async () => {
    const masterKey = await generateMasterKey();
    const otherKey = await generateMasterKey();

    await assert.rejects(() => preparePassphraseAdoption(masterKey, PASSPHRASE, {
        createUnlockWrapping: (_key, passphrase) => createUnlockWrapping(otherKey, passphrase),
        createRecoveryWrapping,
    }), /do not open the master key/u);
    await assert.rejects(() => preparePassphraseAdoption(masterKey, PASSPHRASE, {
        createUnlockWrapping,
        createRecoveryWrapping: () => createRecoveryWrapping(otherKey),
    }), /do not open the master key/u);
    // A verifier the passphrase would not reproduce at the next unlock.
    await assert.rejects(() => preparePassphraseAdoption(masterKey, PASSPHRASE, {
        createUnlockWrapping: async (key, passphrase) => ({ ...await createUnlockWrapping(key, passphrase), verifier: Buffer.alloc(32, 1).toString('base64') }),
        createRecoveryWrapping,
    }), /do not open the master key/u);
    // A wrapping made with another passphrase fails to open at all.
    await assert.rejects(() => preparePassphraseAdoption(masterKey, PASSPHRASE, {
        createUnlockWrapping: (key) => createUnlockWrapping(key, `${PASSPHRASE} sbagliata`),
        createRecoveryWrapping,
    }));
});

test('a passphrase outside the policy prepares nothing', async () => {
    const masterKey = await generateMasterKey();
    await assert.rejects(() => preparePassphraseAdoption(masterKey, 'troppo corta'), /outside the policy: too_short/u);
});
