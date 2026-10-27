import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    buildApiTableFetchErrorMessage,
    captureApiReadSession,
    isApiTableAuthUnavailableStatus,
    isApiTableUnavailableStatus,
} from './api-table-response.ts';

test('isApiTableAuthUnavailableStatus identifies auth failures only', () => {
    assert.equal(isApiTableAuthUnavailableStatus(401), true);
    assert.equal(isApiTableAuthUnavailableStatus(403), true);
    assert.equal(isApiTableAuthUnavailableStatus(404), false);
    assert.equal(isApiTableAuthUnavailableStatus(500), false);
});

test('read session composes caller cancellation and compares session identity even before first unlock', () => {
    let session: AbortSignal | null = null;
    const beforeLogin = captureApiReadSession(() => session);
    beforeLogin.assertCurrent();
    const owner = new AbortController();
    session = owner.signal;
    assert.throws(beforeLogin.assertCurrent, { name: 'AbortError' });
    const caller = new AbortController();
    const read = captureApiReadSession(() => session, caller.signal);
    read.assertCurrent();
    caller.abort();
    assert.equal(read.signal?.aborted, true);
    assert.equal(owner.signal.aborted, false);
    assert.throws(read.assertCurrent, { name: 'AbortError' });
    const nextRead = captureApiReadSession(() => session, new AbortController().signal);
    owner.abort();
    assert.equal(nextRead.signal?.aborted, true);
    assert.throws(nextRead.assertCurrent, { name: 'AbortError' });
});

test('isApiTableUnavailableStatus treats auth and missing rows as unavailable', () => {
    assert.equal(isApiTableUnavailableStatus(401), true);
    assert.equal(isApiTableUnavailableStatus(403), true);
    assert.equal(isApiTableUnavailableStatus(404), true);
    assert.equal(isApiTableUnavailableStatus(500), false);
});

test('buildApiTableFetchErrorMessage includes endpoint and status for diagnosis', () => {
    assert.equal(
        buildApiTableFetchErrorMessage('/api/patients', 'patient-1', 500, 'Internal Server Error'),
        'Failed to fetch /api/patients/patient-1: 500 Internal Server Error',
    );
});
