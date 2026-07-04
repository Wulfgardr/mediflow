import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldReactToChange } from './live-query-scope';

test('unscoped notification wakes every subscriber (backward compatible)', () => {
    // notifyDbChange() with no table === undefined changedTable.
    assert.equal(shouldReactToChange(undefined, undefined), true);
    assert.equal(shouldReactToChange([], undefined), true);
    assert.equal(shouldReactToChange(['entries'], undefined), true);
});

test('unscoped subscriber wakes on any table change', () => {
    assert.equal(shouldReactToChange(undefined, 'entries'), true);
    assert.equal(shouldReactToChange([], 'attachments'), true);
});

test('scoped subscriber wakes only on a matching table', () => {
    assert.equal(shouldReactToChange(['entries'], 'entries'), true);
    assert.equal(shouldReactToChange(['entries', 'therapies'], 'therapies'), true);
});

test('scoped subscriber ignores unrelated table changes', () => {
    assert.equal(shouldReactToChange(['entries'], 'attachments'), false);
    assert.equal(shouldReactToChange(['patients'], 'checkups'), false);
    assert.equal(shouldReactToChange(['entries', 'therapies'], 'observations'), false);
});
