import assert from 'node:assert/strict';

export const clinicalEvents = Object.freeze([
    'patient.created', 'patient.updated', 'patient.archived', 'patient.deleted', 'patient.restored',
    'entry.created', 'entry.updated', 'entry.deleted',
    'therapy.created', 'therapy.updated', 'therapy.deleted',
    'observation.created', 'observation.updated', 'observation.deleted',
    'checkup.created', 'checkup.updated', 'checkup.deleted',
    'attachment.created', 'attachment.updated', 'attachment.deleted',
]);

export const expectedAudit = Object.freeze({
    writes: { 'patient.updated': [2], 'entry.created': [1] },
    resources: {
        'therapy.created': [1], 'therapy.updated': [2],
        'observation.created': [1], 'observation.updated': [2],
        'checkup.created': [1], 'checkup.updated': [2], 'attachment.created': [null],
    },
    profiles: { 'patient.created': [1], 'patient.updated': [2, 3] },
});

// Called on the real SQLite delta after each client has finished its accepted
// writes, blocked replay and stale HTTP requests. Empty or identical omissions
// by both clients must fail rather than being reported as parity.
export function verifyClinicalAudit(rows, expected, actorRef) {
    const observed = {};
    for (const row of rows) {
        assert.ok(clinicalEvents.includes(row.event_type), 'Unexpected clinical event');
        assert.equal(row.outcome, 'success', 'Clinical mutation audit outcome');
        assert.equal(row.actor_type, 'user', 'Clinical mutation actor type');
        assert.equal(row.actor_ref, actorRef, 'Clinical mutation actor');
        assert.equal(row.source_surface, 'native', 'Paired transport audit surface');
        assert.equal(row.subject_type, row.event_type.split('.')[0], 'Clinical mutation subject type');
        assert.ok(typeof row.subject_ref === 'string' && row.subject_ref.length > 0, 'Missing clinical subject');
        const metadata = row.redacted_metadata ? JSON.parse(row.redacted_metadata) : {};
        const version = row.event_type.startsWith('attachment.') ? null : metadata.resourceVersion;
        if (version !== null) assert.ok(Number.isSafeInteger(version) && version > 0, 'Missing resource revision');
        (observed[row.event_type] ??= []).push(version);
    }
    for (const versions of Object.values(observed)) versions.sort((a, b) => a - b);
    assert.deepEqual(observed, expected, 'Exactly one audit per accepted mutation, none for stale/replay');
    return { result: 'pass', acceptedMutationCount: rows.length, events: observed,
        actorChecked: true, subjectsPresent: true, sourceSurface: 'native' };
}
