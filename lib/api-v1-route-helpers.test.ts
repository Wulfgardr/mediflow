/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    parseApiV1Limit,
    parseApiV1NullableDate,
    toApiV1IsoString,
} from './api-v1-route-helpers.ts';

test('parseApiV1Limit preserves existing positive integer limit semantics', () => {
    assert.equal(parseApiV1Limit(null, 100, 200), 100);
    assert.equal(parseApiV1Limit('', 100, 200), 100);
    assert.equal(parseApiV1Limit('25', 100, 200), 25);
    assert.equal(parseApiV1Limit('25abc', 100, 200), 25);
    assert.equal(parseApiV1Limit('999', 100, 200), 200);
    assert.equal(parseApiV1Limit('0', 100, 200), 100);
    assert.equal(parseApiV1Limit('-1', 100, 200), 100);
    assert.equal(parseApiV1Limit('bad', 100, 200), 100);
});

test('parseApiV1NullableDate keeps nullable route date behavior', () => {
    assert.equal(parseApiV1NullableDate(null), null);
    assert.equal(parseApiV1NullableDate(''), null);
    assert.equal(parseApiV1NullableDate(0), null);
    assert.equal(parseApiV1NullableDate('bad-date'), null);
    assert.equal(parseApiV1NullableDate('2026-05-01')?.toISOString(), '2026-05-01T00:00:00.000Z');
});

test('toApiV1IsoString formats valid route dates and returns null for invalid values', () => {
    assert.equal(toApiV1IsoString(new Date('2026-05-01T10:30:00.000Z')), '2026-05-01T10:30:00.000Z');
    assert.equal(toApiV1IsoString('bad-date'), null);
});
