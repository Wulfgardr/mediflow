import assert from 'node:assert/strict';
import test from 'node:test';
import {
    checkupStatusFilterValues,
    normalizeCheckupStatus,
    normalizeTherapyStatus,
    parseCheckupStatus,
    parseTherapyStatus,
    therapyStatusFilterValues,
} from './status-normalization';

test('clinical status parsers reject inherited property names and preserve read fallbacks', () => {
    for (const value of ['constructor', '__proto__', ' CONSTRUCTOR ', ' __PROTO__ ']) {
        assert.equal(parseTherapyStatus(value), null, value);
        assert.equal(parseCheckupStatus(value), null, value);
        assert.equal(normalizeTherapyStatus(value), 'active', value);
        assert.equal(normalizeCheckupStatus(value), 'pending', value);
        assert.equal(normalizeTherapyStatus(value, 'suspended'), 'suspended', value);
        assert.equal(normalizeCheckupStatus(value, 'cancelled'), 'cancelled', value);
    }
});

test('therapy states and legacy aliases retain normalization and filter groups', () => {
    for (const [value, expected] of [
        ['active', 'active'], ['suspended', 'suspended'], ['paused', 'suspended'],
        ['completed', 'completed'], ['stopped', 'completed'], ['interrupted', 'completed'],
    ] as const) {
        assert.equal(parseTherapyStatus(value), expected);
        assert.equal(parseTherapyStatus(` ${value.toUpperCase()} `), expected);
        assert.equal(normalizeTherapyStatus(value), expected);
    }
    assert.deepEqual(therapyStatusFilterValues('active'), ['active']);
    assert.deepEqual(therapyStatusFilterValues(' PAUSED '), ['suspended', 'paused']);
    assert.deepEqual(therapyStatusFilterValues('stopped'), ['completed', 'stopped', 'interrupted']);
});

test('checkup states and legacy aliases retain normalization and filter groups', () => {
    for (const [value, expected] of [
        ['pending', 'pending'], ['completed', 'completed'], ['done', 'completed'],
        ['cancelled', 'cancelled'], ['canceled', 'cancelled'],
    ] as const) {
        assert.equal(parseCheckupStatus(value), expected);
        assert.equal(parseCheckupStatus(` ${value.toUpperCase()} `), expected);
        assert.equal(normalizeCheckupStatus(value), expected);
    }
    assert.deepEqual(checkupStatusFilterValues('pending'), ['pending']);
    assert.deepEqual(checkupStatusFilterValues(' DONE '), ['completed', 'done']);
    assert.deepEqual(checkupStatusFilterValues('canceled'), ['cancelled', 'canceled']);
});

test('unknown and non-string statuses keep the existing null and fallback contract', () => {
    for (const value of [undefined, null, '', ' ', 'unknown', 0, false, {}, []]) {
        assert.equal(parseTherapyStatus(value), null);
        assert.equal(parseCheckupStatus(value), null);
        assert.equal(normalizeTherapyStatus(value), 'active');
        assert.equal(normalizeCheckupStatus(value), 'pending');
    }
    assert.deepEqual(therapyStatusFilterValues(' unknown '), ['unknown']);
    assert.deepEqual(checkupStatusFilterValues(' unknown '), ['unknown']);
});
