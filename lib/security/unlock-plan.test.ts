import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnlockParameters } from './client-auth-api';
import { LONG_PIN_NOTICE, planUnlock } from './unlock-plan';

const PIN_ACCOUNT: UnlockParameters = { credential: 'pin' };
const PASSPHRASE_ACCOUNT: UnlockParameters = { credential: 'passphrase', kdfVersion: 3, salt: 'c3ludGhldGljLXNhbHQ=' };
const PASSPHRASE = 'cavallo batteria graffetta corretta';
const SHORT_PIN = ['2', '4', '6', '8'].join('');
const plan = (attempt: Partial<Parameters<typeof planUnlock>[0]>) =>
    planUnlock({ shown: 'pin', current: PIN_ACCOUNT, secret: SHORT_PIN, longPinConfirmed: false, ...attempt });

test('a PIN travels as typed only to an account the server says is on its PIN, from a field that said PIN', () => {
    assert.deepEqual(plan({}), { action: 'send-pin' });
    assert.deepEqual(plan({ shown: 'passphrase', current: PASSPHRASE_ACCOUNT, secret: PASSPHRASE }), { action: 'derive', salt: PASSPHRASE_ACCOUNT.salt });
});

test('when the server cannot say what unlocks the account, nothing is sent', () => {
    for (const secret of [SHORT_PIN, PASSPHRASE]) {
        for (const shown of ['pin', 'passphrase'] as const) {
            assert.equal(plan({ shown, current: null, secret }).action, 'refuse');
        }
    }
});

test('what was typed into a field that said one thing is never sent as the other', () => {
    // The account moved to a passphrase while this lock screen still said PIN.
    const moved = plan({ shown: 'pin', current: PASSPHRASE_ACCOUNT, secret: PASSPHRASE });
    assert.deepEqual(moved, { action: 'refuse', message: 'Questo archivio ora si sblocca con la passphrase. Inseriscila.' });
    // Not even a short text: it was typed as a PIN and would become a verifier.
    assert.equal(plan({ shown: 'pin', current: PASSPHRASE_ACCOUNT }).action, 'refuse');
    assert.equal(plan({ shown: 'passphrase', current: PIN_ACCOUNT, secret: PASSPHRASE }).action, 'refuse');
});

test('a text the policy would accept as a passphrase does not leave as a PIN on the first gesture', () => {
    // The server's answer may be older than the account: it said PIN, the text may be the new passphrase.
    assert.deepEqual(plan({ secret: PASSPHRASE }), { action: 'confirm-long-pin' });
    assert.match(LONG_PIN_NOTICE, /lungo come una passphrase/u);
    // Counted as the primitives count it: fifteen characters after normalization, five before.
    assert.equal(plan({ secret: 'ﬃ'.repeat(5) }).action, 'confirm-long-pin');
    assert.equal(plan({ secret: 'a'.repeat(14) }).action, 'send-pin');
    // Beyond the policy no passphrase exists: a longer text can only be a PIN.
    assert.equal(plan({ secret: 'a'.repeat(129) }).action, 'send-pin');
    // A PIN chosen that long at first setup still opens its archive, on the second gesture.
    assert.deepEqual(plan({ secret: PASSPHRASE, longPinConfirmed: true }), { action: 'send-pin' });
    // The second gesture does not override what the server says by then.
    assert.equal(plan({ secret: PASSPHRASE, longPinConfirmed: true, current: PASSPHRASE_ACCOUNT }).action, 'refuse');
});

test('a derivation this version does not know is not attempted', () => {
    const newer = plan({ shown: 'passphrase', current: { ...PASSPHRASE_ACCOUNT, kdfVersion: 4 }, secret: PASSPHRASE });
    assert.deepEqual(newer, { action: 'refuse', message: 'Questa versione di MediFlow non sa aprire l’archivio. Aggiorna MediFlow e riprova.' });
});
