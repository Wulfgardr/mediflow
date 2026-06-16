/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    buildApiTableFetchErrorMessage,
    isApiTableAuthUnavailableStatus,
    isApiTableUnavailableStatus,
} from './api-table-response.ts';

test('isApiTableAuthUnavailableStatus identifies auth failures only', () => {
    assert.equal(isApiTableAuthUnavailableStatus(401), true);
    assert.equal(isApiTableAuthUnavailableStatus(403), true);
    assert.equal(isApiTableAuthUnavailableStatus(404), false);
    assert.equal(isApiTableAuthUnavailableStatus(500), false);
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
