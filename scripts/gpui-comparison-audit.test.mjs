import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyClinicalAudit, expectedAudit } from '../experiments/gpui-patient-pilot/comparison/audit.mjs';

const event = (event_type, version, patch = {}) => ({
    event_type, outcome: 'success', actor_type: 'user', actor_ref: 'synthetic-operator',
    subject_type: event_type.split('.')[0], subject_ref: 'synthetic-resource',
    source_surface: 'native', redacted_metadata: JSON.stringify({ resourceVersion: version }), ...patch,
});
const notes = () => [event('patient.updated', 2), event('entry.created', 1)];

test('an accepted notes update and diary create each require their own audit', () => {
    assert.equal(verifyClinicalAudit(notes(), expectedAudit.writes, 'synthetic-operator').acceptedMutationCount, 2);
});
test('equal missing audits in both clients do not count as parity', () => {
    for (const rows of [[], notes().slice(1)]) assert.throws(() => verifyClinicalAudit(rows, expectedAudit.writes, 'synthetic-operator'));
});
test('an audit accidentally emitted for stale or replay is rejected', () => {
    assert.throws(() => verifyClinicalAudit([...notes(), event('patient.updated', 2)], expectedAudit.writes, 'synthetic-operator'));
});
for (const [name, patch] of Object.entries({ actor: { actor_ref: 'other-operator' },
    surface: { source_surface: 'web' }, subject: { subject_ref: null },
    revision: { redacted_metadata: '{}' }, outcome: { outcome: 'denied' } })) {
    test(`audit with wrong ${name} is rejected`, () => {
        const rows = notes(); Object.assign(rows[0], patch);
        assert.throws(() => verifyClinicalAudit(rows, expectedAudit.writes, 'synthetic-operator'));
    });
}
test('resource and profile phases check all declared revisions, including explicit clearing', () => {
    for (const expected of [expectedAudit.resources, expectedAudit.profiles]) {
        const rows = Object.entries(expected).flatMap(([kind, revisions]) => revisions.map(v => event(kind, v)));
        assert.equal(verifyClinicalAudit(rows, expected, 'synthetic-operator').acceptedMutationCount, rows.length);
        assert.throws(() => verifyClinicalAudit(rows.slice(1), expected, 'synthetic-operator'));
    }
});
