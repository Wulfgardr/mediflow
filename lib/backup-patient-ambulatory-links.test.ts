/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichBackupPatientsWithAmbulatoryLinks } from './backup-patient-ambulatory-links';

test('indexes backup ambulatory links once without changing patient membership semantics', () => {
    assert.deepEqual(enrichBackupPatientsWithAmbulatoryLinks([], []), []);

    const patients = [
        { id: 'patient-a', ambulatoryId: 'ambulatory-fallback', updatedAt: new Date('2024-01-01T00:00:00.000Z') },
        { id: 'patient-b', ambulatoryId: null, updatedAt: new Date('2024-01-02T00:00:00.000Z') },
    ];
    const enriched = enrichBackupPatientsWithAmbulatoryLinks(patients, [
        { patientId: 'patient-a', ambulatoryId: 'ambulatory-z', assignedAt: new Date('2024-01-03T00:00:00.000Z') },
        { patientId: 'patient-b', ambulatoryId: 'ambulatory-x', assignedAt: new Date('2024-01-04T00:00:00.000Z') },
        { patientId: 'patient-a', ambulatoryId: 'ambulatory-a', assignedAt: new Date('2024-01-05T00:00:00.000Z') },
        { patientId: 'patient-a', ambulatoryId: 'ambulatory-a', assignedAt: new Date('2024-01-06T00:00:00.000Z') },
    ]);

    assert.deepEqual(enriched.map((patient) => ({
        id: patient.id,
        ids: patient.assignedAmbulatoryIds,
        memberships: patient.assignedAmbulatoryMemberships?.map(({ ambulatoryId, assignedAt }) => [ambulatoryId, assignedAt?.toISOString()]),
    })), [
        {
            id: 'patient-a',
            ids: ['ambulatory-a', 'ambulatory-fallback', 'ambulatory-z'],
            memberships: [['ambulatory-a', '2024-01-06T00:00:00.000Z'], ['ambulatory-fallback', '2024-01-01T00:00:00.000Z'], ['ambulatory-z', '2024-01-03T00:00:00.000Z']],
        },
        {
            id: 'patient-b',
            ids: ['ambulatory-x'],
            memberships: [['ambulatory-x', '2024-01-04T00:00:00.000Z']],
        },
    ]);
});
