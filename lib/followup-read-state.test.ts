import assert from 'node:assert/strict';
import test from 'node:test';
import type { Checkup } from './db';
import { projectFollowupReadState } from './followup-read-state';

const checkups = [{ id: 'synthetic-checkup', title: 'Controllo sintetico', date: new Date('2027-01-10') }] as Checkup[];
test('only a successful empty read is empty, including during rereads with cached rows', () => {
    assert.equal(projectFollowupReadState({ data: undefined, loading: true, error: null }).state, 'loading');
    assert.equal(projectFollowupReadState({ data: [], loading: true, error: null }).state, 'loading');
    assert.equal(projectFollowupReadState({ data: checkups, loading: true, error: null }).state, 'loading');
    assert.equal(projectFollowupReadState({ data: [], loading: false, error: null }).state, 'empty');
    assert.equal(projectFollowupReadState({ data: checkups, loading: false, error: null }).state, 'available');
});
test('failure takes precedence over cached rows, empty arrays and loading', () => {
    for (const data of [undefined, [], checkups]) for (const error of [new Error('synthetic'), false, 0]) {
        const result = projectFollowupReadState({ data, loading: false, error });
        assert.equal(result.state, 'error'); assert.equal(result.count, undefined);
    }
    assert.equal(projectFollowupReadState({ data: [], loading: true, error: new Error('synthetic') }).state, 'error');
});
test('a completed read without a result is unavailable, never empty, loading or offline', () => {
    const result = projectFollowupReadState({ data: undefined, loading: false, error: null });
    assert.equal(result.state, 'unavailable'); assert.equal(result.count, undefined);
    assert.doesNotMatch(result.summary, /Nessun|in corso|offline|in linea/u);
});
test('count comes from the successful follow-up read, independently of other sections', () => {
    const result = projectFollowupReadState({ data: checkups, loading: false, error: null });
    assert.equal(result.count, '1 follow-up');
    assert.equal(projectFollowupReadState({ data: [], loading: false, error: null }).count, '0 follow-up');
});
