import assert from 'node:assert/strict';
import test from 'node:test';

import {
    confirmationPinError,
    isValidConfirmationPin,
    isValidNumericPin,
    numericPinError,
    PIN_DIGITS_ONLY_MESSAGE,
    PIN_LENGTH_MESSAGE,
    PIN_PASSPHRASE_MESSAGE,
    validateConfirmationPinSubmission,
    validateNumericPinSubmission,
} from './pin-input';

test('PIN messages match the configured 4-8 range and contain no em dash', () => {
    assert.equal(PIN_PASSPHRASE_MESSAGE, 'Sembra la passphrase: qui serve il PIN di conferma.');
    assert.equal(PIN_LENGTH_MESSAGE, 'Il PIN ha tra 4 e 8 caratteri.');
    assert.equal(PIN_DIGITS_ONLY_MESSAGE, 'Il PIN richiede da 4 a 8 cifre.');
    for (const message of [PIN_PASSPHRASE_MESSAGE, PIN_LENGTH_MESSAGE, PIN_DIGITS_ONLY_MESSAGE]) {
        assert.equal(message.includes('\u2014'), false, message);
    }
});

test('confirmation PIN accepts numeric and alphanumeric 4-8 char values and rejects passphrases by length', () => {
    for (const valid of ['1234', '314159', 'AbC!09', 'ab cd', '12345678']) {
        assert.equal(isValidConfirmationPin(valid), true, valid);
        assert.equal(confirmationPinError(valid), null, valid);
        assert.equal(validateConfirmationPinSubmission(valid), null, valid);
    }
    for (const typing of ['', '1', 'Ab', 'AbC']) {
        assert.equal(isValidConfirmationPin(typing), false, typing);
        assert.equal(confirmationPinError(typing), null, typing);
        assert.equal(validateConfirmationPinSubmission(typing), PIN_LENGTH_MESSAGE, typing);
    }
    for (const tooLong of ['123456789', 'mia frase', 'demo086086', 'cavallo batteria graffetta corretta']) {
        assert.equal(isValidConfirmationPin(tooLong), false, tooLong);
        assert.equal(confirmationPinError(tooLong), PIN_PASSPHRASE_MESSAGE, tooLong);
        assert.equal(validateConfirmationPinSubmission(tooLong), PIN_PASSPHRASE_MESSAGE, tooLong);
    }
    for (const withControl of ['1234\n', '12\u000034', 'AbC\u007f09']) {
        assert.equal(isValidConfirmationPin(withControl), false, withControl);
        assert.equal(confirmationPinError(withControl), PIN_LENGTH_MESSAGE, withControl);
        assert.equal(validateConfirmationPinSubmission(withControl), PIN_LENGTH_MESSAGE, withControl);
    }
});

test('numeric PIN enforces 4-8 digits and shows the passphrase message for long values', () => {
    for (const valid of ['1234', '314159', '24682468']) {
        assert.equal(isValidNumericPin(valid), true, valid);
        assert.equal(numericPinError(valid), null, valid);
        assert.equal(validateNumericPinSubmission(valid), null, valid);
    }
    for (const typing of ['', '1', '12', '123']) {
        assert.equal(isValidNumericPin(typing), false, typing);
        assert.equal(numericPinError(typing), null, typing);
        assert.equal(validateNumericPinSubmission(typing), PIN_DIGITS_ONLY_MESSAGE, typing);
    }
    for (const nonDigits of ['AbC!09', '1234a', ' 1234 ', 'segreto']) {
        assert.equal(isValidNumericPin(nonDigits), false, nonDigits);
        assert.equal(numericPinError(nonDigits), PIN_DIGITS_ONLY_MESSAGE, nonDigits);
        assert.equal(validateNumericPinSubmission(nonDigits), PIN_DIGITS_ONLY_MESSAGE, nonDigits);
    }
    for (const tooLong of ['cavallo batteria graffetta corretta', 'mia frase', '123456789', '123456789012345']) {
        assert.equal(isValidNumericPin(tooLong), false, tooLong);
        assert.equal(numericPinError(tooLong), PIN_PASSPHRASE_MESSAGE, tooLong);
        assert.equal(validateNumericPinSubmission(tooLong), PIN_PASSPHRASE_MESSAGE, tooLong);
    }
});

test('la lunghezza del PIN di conferma si conta come nella creazione delle credenziali', () => {
    assert.equal('\u{1F600}\u{1F600}'.length, 4);
    assert.equal(isValidConfirmationPin('\u{1F600}\u{1F600}'), true);
    assert.equal(validateConfirmationPinSubmission('\u{1F600}\u{1F600}'), null);
    assert.equal(isValidConfirmationPin('\u{1F600}\u{1F600}\u{1F600}\u{1F600}\u{1F600}'), false);
});
