import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BACKUP_ARTIFACT_FORMAT,
    BACKUP_ARTIFACT_VERSION,
    BACKUP_COLLECTIONS,
    BackupArtifactError,
    createBackupArtifact,
    parseBackupArtifact,
    serializeBackupArtifact,
    stableStringify,
} from './backup-artifact';

const basePayload = {
    ambulatories: [
        {
            id: 'amb-1',
            name: 'Ambulatorio principale',
            createdAt: '2026-03-17T08:00:00.000Z',
        },
    ],
    attachments: [],
    conversations: [
        {
            id: 'conv-1',
            title: 'Scambio clinico',
            createdAt: '2026-03-17T08:05:00.000Z',
        },
    ],
    drugs: [],
    entries: [
        {
            id: 'entry-1',
            patientId: 'pat-1',
            type: 'note',
            date: '2026-03-17T08:10:00.000Z',
            content: 'Nota sintetica',
            createdAt: '2026-03-17T08:10:00.000Z',
        },
    ],
    exemptions: [],
    messages: [
        {
            id: 'msg-1',
            conversationId: 'conv-1',
            role: 'user',
            content: 'Domanda',
            createdAt: '2026-03-17T08:06:00.000Z',
        },
    ],
    observations: [],
    prostheticPrescriptions: [],
    patients: [
        {
            id: 'pat-1',
            firstName: 'Mario',
            lastName: 'Rossi',
            taxCode: 'RSSMRA80A01H501U',
            address: 'ENC:iv:cipher',
            phone: 'ENC:iv:cipher',
            ambulatoryId: 'amb-1',
            assignedAmbulatoryIds: ['amb-1'],
            createdAt: '2026-03-17T08:00:00.000Z',
            updatedAt: '2026-03-17T08:00:00.000Z',
            version: 1,
        },
    ],
    checkups: [],
    therapies: [],
};

test('creates a stable backup artifact with checksum and manifest', async () => {
    const artifact = await createBackupArtifact(basePayload);

    assert.equal(artifact.format, BACKUP_ARTIFACT_FORMAT);
    assert.equal(artifact.version, BACKUP_ARTIFACT_VERSION);
    assert.equal(artifact.manifest.scope, 'mediflow-web-local-backup');
    assert.deepEqual(artifact.manifest.collections, BACKUP_COLLECTIONS);
    assert.equal(artifact.manifest.recordCounts.patients, 1);
    assert.equal(artifact.manifest.recordCounts.messages, 1);

    const serialized = await serializeBackupArtifact(basePayload);
    const parsed = await parseBackupArtifact(JSON.parse(serialized));

    assert.equal(parsed.manifest.checksum, artifact.manifest.checksum);
    assert.equal(stableStringify(parsed.payload), stableStringify(basePayload));
});

test('rejects tampered payloads before restore', async () => {
    const serialized = await serializeBackupArtifact(basePayload);
    const tampered = JSON.parse(serialized);
    tampered.payload.patients[0].firstName = 'Luigi';

    await assert.rejects(
        () => parseBackupArtifact(tampered),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'checksum-mismatch',
    );
});

test('preserves patient assigned ambulatory ids inside the backup payload', async () => {
    const serialized = await serializeBackupArtifact({
        ...basePayload,
        patients: [{
            ...basePayload.patients[0],
            assignedAmbulatoryIds: ['amb-2', 'amb-1', 'amb-2'],
        }],
        ambulatories: [
            ...basePayload.ambulatories,
            {
                id: 'amb-2',
                name: 'Ambulatorio secondario',
                createdAt: '2026-03-17T08:01:00.000Z',
            },
        ],
    });

    const parsed = await parseBackupArtifact(JSON.parse(serialized));
    assert.deepEqual(parsed.payload.patients[0].assignedAmbulatoryIds, ['amb-2', 'amb-1', 'amb-2']);
});

test('rejects patient assigned ambulatory ids that reference missing ambulatories', async () => {
    const serialized = await serializeBackupArtifact(basePayload);
    const tampered = JSON.parse(serialized);
    tampered.payload.patients[0].assignedAmbulatoryIds = ['amb-missing'];

    await assert.rejects(
        () => parseBackupArtifact(tampered),
        (error: unknown) => error instanceof BackupArtifactError && error.code === 'invalid-manifest',
    );
});
