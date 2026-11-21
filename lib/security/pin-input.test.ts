import assert from 'node:assert/strict';
import test from 'node:test';

import {
    acceptNumericPinChange,
    isValidNumericPin,
    PIN_DIGITS_ONLY_MESSAGE,
    PIN_LENGTH_MESSAGE,
    validateNumericPinSubmission,
} from './pin-input';

test('PIN messages match the configured 4-8 digit range and contain no em dash', () => {
    assert.equal(PIN_DIGITS_ONLY_MESSAGE, 'PIN di 4-8 cifre, non la passphrase.');
    assert.equal(PIN_LENGTH_MESSAGE, 'Il PIN ha tra 4 e 8 cifre.');
    assert.equal(PIN_DIGITS_ONLY_MESSAGE.includes('\u2014'), false);
    assert.equal(PIN_LENGTH_MESSAGE.includes('\u2014'), false);
});

test('acceptNumericPinChange accepts digits up to the maximum length and clears on empty', () => {
    assert.deepEqual(acceptNumericPinChange('', '12'), { ok: true, value: '', error: null });
    assert.deepEqual(acceptNumericPinChange('1', ''), { ok: true, value: '1', error: null });
    assert.deepEqual(acceptNumericPinChange('2468', '246'), { ok: true, value: '2468', error: null });
    assert.deepEqual(acceptNumericPinChange('24682468', '2468246'), { ok: true, value: '24682468', error: null });
});

test('acceptNumericPinChange rejects passphrases and non-digit input without retaining them', () => {
    for (const pasted of ['cavallo batteria graffetta corretta', 'mia frase', '1234a', ' 1234 ', '1234!']) {
        assert.deepEqual(
            acceptNumericPinChange(pasted, ''),
            { ok: false, value: '', error: PIN_DIGITS_ONLY_MESSAGE },
            pasted,
        );
    }
    assert.deepEqual(acceptNumericPinChange('1234a', '1234'), { ok: false, value: '1234', error: PIN_DIGITS_ONLY_MESSAGE });
    assert.deepEqual(acceptNumericPinChange('123456789', '12345678'), { ok: false, value: '12345678', error: PIN_LENGTH_MESSAGE });
    assert.deepEqual(acceptNumericPinChange('123456789012345', ''), { ok: false, value: '', error: PIN_DIGITS_ONLY_MESSAGE });
});

test('isValidNumericPin and validateNumericPinSubmission enforce 4-8 digits only', () => {
    for (const valid of ['1234', '314159', '24682468']) {
        assert.equal(isValidNumericPin(valid), true, valid);
        assert.equal(validateNumericPinSubmission(valid), null, valid);
    }
    for (const shortOrLong of ['', '123', '123456789']) {
        assert.equal(isValidNumericPin(shortOrLong), false, shortOrLong);
        assert.equal(validateNumericPinSubmission(shortOrLong), PIN_LENGTH_MESSAGE, shortOrLong);
    }
    for (const nonDigits of ['cavallo batteria graffetta corretta', 'segreto', '1234a', '123456789012345']) {
        assert.equal(isValidNumericPin(nonDigits), false, nonDigits);
        assert.equal(validateNumericPinSubmission(nonDigits), PIN_DIGITS_ONLY_MESSAGE, nonDigits);
    }
});
